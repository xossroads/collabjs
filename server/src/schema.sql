-- CollabJS Database Schema
-- Run with: psql $DATABASE_URL -f schema.sql

-- Store Y.js document state
CREATE TABLE IF NOT EXISTS documents (
  room_id VARCHAR(255) PRIMARY KEY,
  data BYTEA NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Track keyboard activity. client_id is the localStorage UUID (nullable:
-- rows from before the column existed key by username instead) — it's what
-- host stats group by, so renames don't split a person's numbers.
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  room_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  keystroke_count INTEGER NOT NULL,
  in_editor BOOLEAN NOT NULL,
  client_id VARCHAR(36),
  recorded_at TIMESTAMP DEFAULT NOW()
);
-- Idempotent migration for volumes created before client_id existed.
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS client_id VARCHAR(36);

-- User sessions
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  client_id VARCHAR(255) UNIQUE NOT NULL,
  last_seen TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_activity_room ON activity_logs(room_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(username);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_logs(recorded_at);

-- Indexes supporting TTL cleanup. Without these, the periodic DELETE has to
-- scan the whole table.
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

-- Per-room host: at most one host per room, set the first time someone
-- claims it. Password hash uses scrypt with a per-row salt; format
-- "scrypt:<salt-hex>:<hash-hex>" so the algorithm is part of the stored
-- value (lets us migrate later without ambiguity).
CREATE TABLE IF NOT EXISTS room_hosts (
  room_id VARCHAR(255) PRIMARY KEY,
  password_hash TEXT NOT NULL,
  claimed_at TIMESTAMP DEFAULT NOW()
);

-- Host session tokens. We store the SHA-256 of the token so a DB leak does
-- not hand out live host sessions. Cascade delete with the room_host row
-- so revoking host nukes all outstanding sessions.
CREATE TABLE IF NOT EXISTS host_sessions (
  token_hash TEXT PRIMARY KEY,
  room_id VARCHAR(255) NOT NULL REFERENCES room_hosts(room_id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_host_sessions_room ON host_sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_host_sessions_expires ON host_sessions(expires_at);
