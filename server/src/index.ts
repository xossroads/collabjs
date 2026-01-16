import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import express from 'express';
import cors from 'cors';
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

app.use(cors());
app.use(express.json());

// Serve static files in production
if (isProduction) {
  const clientDistPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDistPath));
}

// Activity logging endpoint
app.post('/api/activity', async (req, res) => {
  if (!dbAvailable) {
    return res.json({ success: true, persisted: false });
  }

  try {
    const { roomId, username, keystrokeCount, inEditor } = req.body;

    if (!roomId || !username || keystrokeCount === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await logActivity(roomId, username, keystrokeCount, inEditor);
    res.json({ success: true, persisted: true });
  } catch (error) {
    console.error('Error logging activity:', error);
    res.json({ success: true, persisted: false });
  }
});

// User registration/update endpoint
app.post('/api/user', async (req, res) => {
  if (!dbAvailable) {
    return res.json({ success: true, persisted: false });
  }

  try {
    const { username, clientId } = req.body;

    if (!username || !clientId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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
