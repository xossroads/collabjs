import { randomBytes, scrypt, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const ENCODING_PREFIX = 'scrypt';

// Hash format: "scrypt:<salt-hex>:<hash-hex>". The algorithm name is part of
// the stored string so a future migration to argon2 / bcrypt / etc. can be
// detected without ambiguity (verifyPassword would route on the prefix).
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEY_BYTES);
  return `${ENCODING_PREFIX}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== ENCODING_PREFIX) return false;

  let saltBuf: Buffer;
  let storedHash: Buffer;
  try {
    saltBuf = Buffer.from(parts[1], 'hex');
    storedHash = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (storedHash.length !== KEY_BYTES) return false;

  const candidate = await scryptAsync(password, saltBuf, KEY_BYTES);
  return timingSafeEqual(candidate, storedHash);
}

// Tokens are 32 random bytes (256 bits) rendered as hex. The plaintext token
// is what we hand to the client; only the SHA-256 of it lives in the DB, so
// a database leak cannot be turned into live host sessions.
const TOKEN_BYTES = 32;

export function generateToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(TOKEN_BYTES).toString('hex');
  return { plaintext, hash: hashToken(plaintext) };
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
