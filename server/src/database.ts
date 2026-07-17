import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/collabjs',
});

export async function getDocument(roomId: string): Promise<Buffer | null> {
  const result = await pool.query(
    'SELECT data FROM documents WHERE room_id = $1',
    [roomId]
  );
  return result.rows[0]?.data || null;
}

export async function saveDocument(roomId: string, data: Buffer): Promise<void> {
  await pool.query(
    `INSERT INTO documents (room_id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = $2, updated_at = NOW()`,
    [roomId, data]
  );
}

export async function logActivity(
  roomId: string,
  username: string,
  keystrokeCount: number,
  inEditor: boolean,
  clientId: string
): Promise<void> {
  await pool.query(
    `INSERT INTO activity_logs (room_id, username, keystroke_count, in_editor, client_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [roomId, username, keystrokeCount, inEditor, clientId]
  );
}

export async function upsertUser(username: string, clientId: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (username, client_id, last_seen)
     VALUES ($1, $2, NOW())
     ON CONFLICT (client_id)
     DO UPDATE SET username = $1, last_seen = NOW()`,
    [username, clientId]
  );
}

// Per-user activity aggregates for a room, hottest typist first. Grouped by
// client_id so renames don't split a person's stats; legacy rows (NULL
// client_id) fall back to grouping by username. The reported username is the
// latest one seen for the group, so a renamed user shows under their current
// name.
export interface RoomUserStats {
  client_id: string | null;
  username: string;
  keystrokes: number;
  first_active: Date;
  last_active: Date;
}

export async function getRoomActivityStats(
  roomId: string
): Promise<RoomUserStats[]> {
  const result = await pool.query(
    `SELECT client_id,
            (ARRAY_AGG(username ORDER BY recorded_at DESC))[1] AS username,
            SUM(keystroke_count)::int AS keystrokes,
            MIN(recorded_at) AS first_active,
            MAX(recorded_at) AS last_active
       FROM activity_logs
      WHERE room_id = $1
      GROUP BY COALESCE(client_id, username), client_id
      ORDER BY keystrokes DESC`,
    [roomId]
  );
  return result.rows;
}

export async function testConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// --- Per-room host -----------------------------------------------------

export async function getRoomHost(
  roomId: string
): Promise<{ password_hash: string } | null> {
  const result = await pool.query(
    'SELECT password_hash FROM room_hosts WHERE room_id = $1',
    [roomId]
  );
  return result.rows[0] || null;
}

// Insert a new host row only if no row exists for this room. Returns true
// if the insert won the race, false if someone else already claimed.
export async function tryClaimRoomHost(
  roomId: string,
  passwordHash: string
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO room_hosts (room_id, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (room_id) DO NOTHING`,
    [roomId, passwordHash]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createHostSession(
  tokenHash: string,
  roomId: string,
  expiresAt: Date
): Promise<void> {
  await pool.query(
    `INSERT INTO host_sessions (token_hash, room_id, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash, roomId, expiresAt]
  );
}

export async function getHostSession(
  tokenHash: string
): Promise<{ room_id: string; expires_at: Date } | null> {
  const result = await pool.query(
    `SELECT room_id, expires_at
       FROM host_sessions
      WHERE token_hash = $1
        AND expires_at > NOW()`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

// Wipe every session for a room. Used to enforce single-host-session-at-a-time
// (called before issuing a new session on claim/login) and to power the
// "Log out everywhere" host action. Returns the number of sessions revoked.
export async function revokeAllHostSessions(roomId: string): Promise<number> {
  const result = await pool.query(
    'DELETE FROM host_sessions WHERE room_id = $1',
    [roomId]
  );
  return result.rowCount ?? 0;
}

export async function purgeExpiredHostSessions(): Promise<number> {
  const result = await pool.query(
    'DELETE FROM host_sessions WHERE expires_at < NOW()'
  );
  return result.rowCount ?? 0;
}

// Wipe everything for a single room: document state, activity logs, host
// record (cascade-deletes its sessions). Run inside a single transaction
// so a failure mid-way doesn't leave a half-deleted room behind.
export async function deleteRoom(roomId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM activity_logs WHERE room_id = $1', [roomId]);
    await client.query('DELETE FROM documents WHERE room_id = $1', [roomId]);
    // host_sessions cascade-deletes via the FK on room_hosts.
    await client.query('DELETE FROM room_hosts WHERE room_id = $1', [roomId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// --- TTL purges ---------------------------------------------------------

// TTL purges. Each takes the maximum age in days and returns the number of
// rows deleted, so the caller can log it. Postgres's INTERVAL accepts an
// integer cast at the parameter site to avoid SQL injection.
export async function purgeStaleDocuments(maxAgeDays: number): Promise<number> {
  const result = await pool.query(
    `DELETE FROM documents WHERE updated_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [maxAgeDays]
  );
  return result.rowCount ?? 0;
}

export async function purgeOldActivityLogs(maxAgeDays: number): Promise<number> {
  const result = await pool.query(
    `DELETE FROM activity_logs WHERE recorded_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [maxAgeDays]
  );
  return result.rowCount ?? 0;
}

export async function purgeStaleUsers(maxAgeDays: number): Promise<number> {
  const result = await pool.query(
    `DELETE FROM users WHERE last_seen < NOW() - ($1::int * INTERVAL '1 day')`,
    [maxAgeDays]
  );
  return result.rowCount ?? 0;
}

export { pool };
