-- CollabJS Database Schema
-- Run with: psql $DATABASE_URL -f schema.sql

-- Store Y.js document state
CREATE TABLE IF NOT EXISTS documents (
  room_id VARCHAR(255) PRIMARY KEY,
  data BYTEA NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Track keyboard activity
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  room_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  keystroke_count INTEGER NOT NULL,
  in_editor BOOLEAN NOT NULL,
  recorded_at TIMESTAMP DEFAULT NOW()
);

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
