import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response, NextFunction } from 'express';
import {
  getDocument,
  saveDocument,
  logActivity,
  upsertUser,
  testConnection,
  getRoomHost,
  tryClaimRoomHost,
  createHostSession,
  getHostSession,
  revokeAllHostSessions,
  deleteRoom,
} from './database.js';
import { startCleanupJob } from './cleanup.js';
import { getClientIp, requestLogger, sanitizeForLog } from './logging.js';
import { hashPassword, verifyPassword, generateToken, hashToken } from './password.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Track if database is available
let dbAvailable = false;

// Mirror of the client-side room-ID regex. Reject any documentName that
// doesn't match — Hocuspocus would otherwise accept whatever string a client
// sends (including newlines, slashes, or strings long enough to break the
// VARCHAR(255) on the documents table).
const DOCUMENT_NAME_RE = /^[a-zA-Z0-9-]{1,128}$/;

// Per-IP cap on concurrent WebSocket connections. Without this, one client
// can open thousands of WS connections and pin server memory. The default is
// generous (20) because legitimate users may have multiple tabs; tune via
// MAX_WS_CONNECTIONS_PER_IP if needed.
const MAX_WS_PER_IP = (() => {
  const raw = process.env.MAX_WS_CONNECTIONS_PER_IP;
  if (!raw) return 20;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 20;
})();
const wsConnectionsByIp = new Map<string, number>();

// Rooms currently being deleted by a host. The fetch/store hooks and onConnect
// short-circuit for any room in this set so that:
//   - Hocuspocus's final save during unloadDocument doesn't re-create the
//     documents row we're about to delete (or just deleted).
//   - A reconnecting client can't start a fresh session against the doomed
//     room mid-nuke.
// Entries live for the duration of the DELETE /api/rooms/:id handler.
const roomsBeingNuked = new Set<string>();

// Test database connection on startup
testConnection().then(available => {
  dbAvailable = available;
  if (available) {
    console.log('Database connected successfully');
  } else {
    console.log('Database not available - running without persistence');
  }
});

// Periodic TTL cleanup. The job reads dbAvailable on each tick so it picks
// up a database that came online after startup, and no-ops if it's still
// down.
startCleanupJob(() => dbAvailable);

// Hocuspocus server with PostgreSQL persistence
const hocuspocus = Server.configure({
  debounce: 2000,
  maxDebounce: 10000,

  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        if (!dbAvailable) return null;
        if (roomsBeingNuked.has(documentName)) return null;
        try {
          const data = await getDocument(documentName);
          return data ? new Uint8Array(data) : null;
        } catch {
          return null;
        }
      },
      store: async ({ documentName, state }) => {
        if (!dbAvailable) return;
        // Skip the save during a nuke so we don't immediately undo the
        // delete. unloadDocument fires this hook one last time on the way
        // out, and we want that no-op while we're tearing the room down.
        if (roomsBeingNuked.has(documentName)) return;
        try {
          await saveDocument(documentName, Buffer.from(state));
        } catch (error) {
          console.error('Failed to persist document:', error);
        }
      },
    }),
  ],

  async onConnect({ documentName, request, requestHeaders, socketId }) {
    const ip = getClientIp(request, requestHeaders);

    // Reject malformed document names. Throwing rejects the connection.
    if (!DOCUMENT_NAME_RE.test(documentName)) {
      console.warn(
        `WS reject (bad docName) ip=${sanitizeForLog(ip)} socket=${socketId} name=${sanitizeForLog(documentName).slice(0, 64)}`
      );
      throw new Error('Invalid document name');
    }

    // Reject if the room is being nuked. Otherwise a reconnecting client
    // could hold the doc in memory while we're deleting it.
    if (roomsBeingNuked.has(documentName)) {
      throw new Error('Room is being deleted');
    }

    // Enforce per-IP connection cap. Count is incremented here and decremented
    // in onDisconnect, so a connection that throws here never gets counted.
    const current = wsConnectionsByIp.get(ip) ?? 0;
    if (current >= MAX_WS_PER_IP) {
      console.warn(
        `WS reject (over per-IP cap) ip=${sanitizeForLog(ip)} cap=${MAX_WS_PER_IP}`
      );
      throw new Error('Too many connections');
    }
    wsConnectionsByIp.set(ip, current + 1);

    console.log(
      `WS connect room=${sanitizeForLog(documentName)} socket=${socketId} ip=${sanitizeForLog(ip)} per_ip=${current + 1}`
    );
  },

  async onDisconnect({ documentName, requestHeaders, socketId, clientsCount }) {
    const ip = getClientIp(undefined, requestHeaders);

    const current = wsConnectionsByIp.get(ip) ?? 0;
    if (current <= 1) {
      wsConnectionsByIp.delete(ip);
    } else {
      wsConnectionsByIp.set(ip, current - 1);
    }

    console.log(
      `WS disconnect room=${sanitizeForLog(documentName)} socket=${socketId} ip=${sanitizeForLog(ip)} remaining=${clientsCount}`
    );
  },
});

// Express app setup
const app = express();

// Trust the reverse proxy (nginx) so rate limits key off the real client IP
// from X-Forwarded-For instead of the proxy IP.
if (isProduction) {
  app.set('trust proxy', 1);
}

// Structured one-line-per-request log: method, path, status, duration, IP,
// truncated UA. Goes to stdout. Sits before everything else so even rejected
// requests (CORS, rate limit, validation 400) get logged.
app.use(requestLogger);

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

// --- Per-room host -----------------------------------------------------
//
// One host per room, set by whoever claims it first with a password. After
// claim, accessing the host role on this room requires the password.

const PASSWORD_MIN_LEN = 8;
// scrypt's standard limit for the password buffer is generous, but we cap at
// 72 to match common bcrypt-era expectations and to bound abuse.
const PASSWORD_MAX_LEN = 72;
const HOST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Precomputed dummy hash for the host-login path. When a room has no host
// yet, we still want to spend the same time the verify path would, so an
// attacker can't tell "no host yet" from "host set, wrong password" by
// timing. Computed once at startup.
const DUMMY_HASH_PROMISE = hashPassword('!unclaimed-room-placeholder!');

// Push a "host-state-changed" stateless message to every client connected
// to the room. The client's onStateless handler re-fetches host status and
// updates the UI live, instead of staying out of sync until the next reload.
// Silently no-ops if no doc is loaded (nobody's connected to push to).
function broadcastHostStateChanged(roomId: string): void {
  const doc = hocuspocus.documents.get(roomId);
  if (!doc) return;
  doc.broadcastStateless(JSON.stringify({ type: 'host-state-changed' }));
}

function isValidRoomIdParam(v: string | undefined): v is string {
  return typeof v === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(v);
}

function isValidPassword(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length >= PASSWORD_MIN_LEN &&
    v.length <= PASSWORD_MAX_LEN
  );
}

// GET host status — public, but accepts an optional Bearer token. Returns
// whether the room has been claimed and (if a token is supplied) whether it
// authenticates the caller as the current host. The client uses this to
// reconcile localStorage state with reality on page load: a token that's
// been revoked elsewhere (newer login, logout-everywhere, nuked room) flips
// the UI back to the unauthenticated state instead of pretending we're
// still the host.
app.get('/api/rooms/:id/host', async (req, res) => {
  const roomId = req.params.id;
  if (!isValidRoomIdParam(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }
  if (!dbAvailable) {
    return res.json({ claimed: false, available: false, authed: false });
  }
  try {
    const row = await getRoomHost(roomId);

    let authed = false;
    const auth = req.headers.authorization;
    if (row && auth?.startsWith('Bearer ') && auth.length >= 8) {
      const session = await getHostSession(hashToken(auth.slice(7)));
      authed = !!session && session.room_id === roomId;
    }

    res.json({ claimed: !!row, available: true, authed });
  } catch (error) {
    console.error('host status lookup failed:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// Claim host for a room. Atomic: only the first concurrent caller wins.
app.post('/api/rooms/:id/claim', async (req, res) => {
  const roomId = req.params.id;
  if (!isValidRoomIdParam(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }
  const { password } = req.body ?? {};
  if (!isValidPassword(password)) {
    return res.status(400).json({
      error: `Password must be ${PASSWORD_MIN_LEN}-${PASSWORD_MAX_LEN} characters`,
    });
  }
  if (!dbAvailable) {
    return res.status(503).json({ error: 'Host feature unavailable' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const won = await tryClaimRoomHost(roomId, passwordHash);
    if (!won) {
      return res.status(409).json({ error: 'Room already has a host' });
    }

    // Single-session policy: a fresh claim mints exactly one valid session.
    // (No prior sessions can exist for this brand-new claim, but the revoke
    // is harmless and keeps the claim/login paths symmetric.)
    await revokeAllHostSessions(roomId);

    const { plaintext, hash } = generateToken();
    const expiresAt = new Date(Date.now() + HOST_SESSION_TTL_MS);
    await createHostSession(hash, roomId, expiresAt);

    broadcastHostStateChanged(roomId);
    res.status(201).json({ token: plaintext, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error('host claim failed:', error);
    res.status(500).json({ error: 'Claim failed' });
  }
});

// Authenticate as the room's existing host.
app.post('/api/rooms/:id/host-login', async (req, res) => {
  const roomId = req.params.id;
  if (!isValidRoomIdParam(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }
  const { password } = req.body ?? {};
  if (typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!dbAvailable) {
    return res.status(503).json({ error: 'Host feature unavailable' });
  }

  try {
    const row = await getRoomHost(roomId);
    // Always run exactly one verify so timing doesn't leak whether the room
    // has been claimed. The dummy hash is precomputed so we don't pay extra
    // scrypt time on the unclaimed branch.
    const encodedToCompare = row ? row.password_hash : await DUMMY_HASH_PROMISE;
    const ok = await verifyPassword(password, encodedToCompare);
    if (!row || !ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Single-session policy: a successful login revokes every other session
    // for this room. Latest login wins; older tabs/devices get 401 the next
    // time they try to do anything.
    await revokeAllHostSessions(roomId);

    const { plaintext, hash } = generateToken();
    const expiresAt = new Date(Date.now() + HOST_SESSION_TTL_MS);
    await createHostSession(hash, roomId, expiresAt);

    broadcastHostStateChanged(roomId);
    res.json({ token: plaintext, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error('host login failed:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Auth middleware: validates the Bearer token, looks up the session, and
// confirms the session is for the same room as the URL parameter. Attaches
// the room id to the request as a typed property; downstream handlers can
// trust that req.hostRoomId === req.params.id when they run.
interface HostRequest extends Request {
  hostRoomId?: string;
}

async function requireHost(
  req: HostRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const roomId = req.params.id;
  if (!isValidRoomIdParam(roomId)) {
    res.status(400).json({ error: 'Invalid room id' });
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ') || auth.length < 8) {
    res.status(401).json({ error: 'Auth required' });
    return;
  }
  const token = auth.slice(7);
  if (!dbAvailable) {
    res.status(503).json({ error: 'Host feature unavailable' });
    return;
  }
  try {
    const session = await getHostSession(hashToken(token));
    if (!session) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    if (session.room_id !== roomId) {
      res.status(403).json({ error: 'Token does not match this room' });
      return;
    }
    req.hostRoomId = session.room_id;
    next();
  } catch (error) {
    console.error('host auth check failed:', error);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

// Revoke every host session for the room — including the caller's. Used to
// implement "Log out everywhere" so a host can boot suspected stale sessions
// without changing the password. The room itself stays intact.
app.post('/api/rooms/:id/host/logout-all', requireHost, async (req: HostRequest, res) => {
  const roomId = req.hostRoomId!;
  try {
    const revoked = await revokeAllHostSessions(roomId);
    broadcastHostStateChanged(roomId);
    console.log(`HOST logout-all room=${sanitizeForLog(roomId)} revoked=${revoked}`);
    res.status(204).end();
  } catch (error) {
    console.error('host logout-all failed:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Nuke the room. Wipes Y.js state, activity logs, the host record (which
// cascade-clears all session tokens), and force-disconnects every connected
// client. The roomsBeingNuked guard keeps a reconnecting client or the
// final unloadDocument save from re-creating rows we're deleting.
//
// Before kicking connections, we broadcast a stateless "nuked" message so
// any other open tabs in the room can reload and drop their local Y.Doc
// state. Without this, those tabs auto-reconnect after closeConnections and
// re-sync their *previous* doc content into the empty server doc — the
// nuke would visually un-do itself.
app.delete('/api/rooms/:id', requireHost, async (req: HostRequest, res) => {
  const roomId = req.hostRoomId!;
  roomsBeingNuked.add(roomId);
  try {
    // 1. Tell every connected client to reload — they'll come back with a
    //    fresh Y.Doc and won't repopulate the server-side state.
    const doc = hocuspocus.documents.get(roomId);
    if (doc) {
      doc.broadcastStateless(JSON.stringify({ type: 'room-nuked' }));
      // Give the WS buffer a moment to flush before we slam connections shut.
      await new Promise((r) => setTimeout(r, 100));
    }

    // 2. Drop in-memory state and force-disconnect anyone still attached.
    hocuspocus.closeConnections(roomId);
    if (doc) {
      await hocuspocus.unloadDocument(doc);
    }

    // 3. Wipe DB rows transactionally.
    await deleteRoom(roomId);

    console.log(`HOST nuke room=${sanitizeForLog(roomId)}`);
    res.status(204).end();
  } catch (error) {
    console.error('nuke failed:', error);
    res.status(500).json({ error: 'Nuke failed' });
  } finally {
    roomsBeingNuked.delete(roomId);
  }
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
