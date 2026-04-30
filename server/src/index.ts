import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDocument, saveDocument, logActivity, upsertUser, testConnection } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Track if database is available
let dbAvailable = false;

// Test database connection on startup
testConnection().then(available => {
  dbAvailable = available;
  if (available) {
    console.log('Database connected successfully');
  } else {
    console.log('Database not available - running without persistence');
  }
});

// Hocuspocus server with PostgreSQL persistence
const hocuspocus = Server.configure({
  debounce: 2000,
  maxDebounce: 10000,

  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        if (!dbAvailable) return null;
        try {
          const data = await getDocument(documentName);
          return data ? new Uint8Array(data) : null;
        } catch {
          return null;
        }
      },
      store: async ({ documentName, state }) => {
        if (!dbAvailable) return;
        try {
          await saveDocument(documentName, Buffer.from(state));
        } catch (error) {
          console.error('Failed to persist document:', error);
        }
      },
    }),
  ],

  async onConnect({ documentName }) {
    console.log(`Client connected to room: ${documentName}`);
  },

  async onDisconnect({ documentName }) {
    console.log(`Client disconnected from room: ${documentName}`);
  },
});

// Express app setup
const app = express();

// Trust the reverse proxy (nginx) so rate limits key off the real client IP
// from X-Forwarded-For instead of the proxy IP.
if (isProduction) {
  app.set('trust proxy', 1);
}

// CORS allowlist. In dev the Vite client runs on a different port (5173) and
// needs to talk to the API on 3001, so we allow that origin explicitly. In
// prod everything is same-origin behind nginx, so we can lock CORS down to
// the configured ALLOWED_ORIGINS list (comma-separated).
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
const allowedOrigins: string[] = allowedOriginsEnv
  ? allowedOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
  : isProduction
    ? []
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin requests (no Origin header) are always allowed.
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Disallowed: omit the Access-Control-Allow-Origin header so the
      // browser's SOP blocks the response. Don't throw — that turns into a
      // 500 and gives the caller more information than they need.
      callback(null, false);
    },
  })
);

// Security response headers. CSP itself lives in a <meta> tag in index.html
// because the dev server (Vite) bypasses Express, but a few headers can only
// be set at the response level — set them here for production. The sandbox
// iframe is loaded via iframe.src to a same-origin runner, so SAMEORIGIN
// (rather than DENY) is the strictest setting that still permits it.
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  next();
});

// Cap request bodies. The endpoints accept tiny JSON objects; anything bigger
// is abuse.
app.use(express.json({ limit: '2kb' }));

// Rate limit anything under /api/. Defaults to 60 req/min per IP — well above
// what the legitimate client sends (one user/activity post per minute) and
// well below what a script can use to swamp the API.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
app.use('/api/', apiLimiter);

// --- Input validation helpers ------------------------------------------------
// Awareness names and room IDs come from clients we don't trust. Validate
// shape and length on every entry; reject rather than coerce.

const ROOM_ID_RE = /^[a-zA-Z0-9-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_USERNAME_LEN = 64;
const MAX_KEYSTROKES_PER_REPORT = 100_000;

function isString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function isRoomId(v: unknown): v is string {
  return typeof v === 'string' && ROOM_ID_RE.test(v);
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isCount(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= 0 &&
    v <= MAX_KEYSTROKES_PER_REPORT &&
    Number.isInteger(v)
  );
}

// Serve static files in production
if (isProduction) {
  const clientDistPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDistPath));
}

// Activity logging endpoint
app.post('/api/activity', async (req, res) => {
  const { roomId, username, keystrokeCount, inEditor } = req.body ?? {};

  if (
    !isRoomId(roomId) ||
    !isString(username, MAX_USERNAME_LEN) ||
    !isCount(keystrokeCount) ||
    typeof inEditor !== 'boolean'
  ) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  if (!dbAvailable) {
    return res.json({ success: true, persisted: false });
  }

  try {
    await logActivity(roomId, username, keystrokeCount, inEditor);
    res.json({ success: true, persisted: true });
  } catch (error) {
    console.error('Error logging activity:', error);
    res.json({ success: true, persisted: false });
  }
});

// User registration/update endpoint
app.post('/api/user', async (req, res) => {
  const { username, clientId } = req.body ?? {};

  if (!isString(username, MAX_USERNAME_LEN) || !isUuid(clientId)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  if (!dbAvailable) {
    return res.json({ success: true, persisted: false });
  }

  try {
    await upsertUser(username, clientId);
    res.json({ success: true, persisted: true });
  } catch (error) {
    console.error('Error upserting user:', error);
    res.json({ success: true, persisted: false });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: dbAvailable,
    environment: NODE_ENV,
  });
});

// Serve index.html for all other routes (SPA fallback) in production
if (isProduction) {
  app.get('*', (req, res) => {
    const clientDistPath = path.join(__dirname, '../../client/dist');
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Start servers
app.listen(API_PORT, () => {
  console.log(`REST API running on http://localhost:${API_PORT}`);
});

hocuspocus.listen(PORT).then(() => {
  console.log(`Hocuspocus WebSocket server running on ws://localhost:${PORT}`);
});
