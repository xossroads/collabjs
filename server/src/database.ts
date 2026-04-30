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
  inEditor: boolean
): Promise<void> {
  await pool.query(
    `INSERT INTO activity_logs (room_id, username, keystroke_count, in_editor)
     VALUES ($1, $2, $3, $4)`,
    [roomId, username, keystrokeCount, inEditor]
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

export async function testConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

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
