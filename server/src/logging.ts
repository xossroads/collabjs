import type { IncomingMessage, IncomingHttpHeaders } from 'http';
import type { Request, Response, NextFunction } from 'express';

// Resolve the real client IP. Behind nginx the `trust proxy` Express setting
// already does this for req.ip, but we call it directly from Hocuspocus too,
// which doesn't have Express's helpers — so do it ourselves and use the same
// rules everywhere. Order matters: x-forwarded-for is the standard, x-real-ip
// is what nginx sets on /ws today, raw socket is the fallback for direct
// connections.
export function getClientIp(
  req: IncomingMessage | undefined,
  headers: IncomingHttpHeaders
): string {
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].split(',')[0].trim();
  }
  const xri = headers['x-real-ip'];
  if (typeof xri === 'string') return xri;
  return req?.socket?.remoteAddress || 'unknown';
}

// Strip ASCII control characters (newlines, escapes, etc.) from a value
// before it reaches a log line. Without this, an attacker who can supply a
// username, room ID, or User-Agent header can forge log entries that look
// like they came from us. Replaces stripped chars with '?' so length is
// preserved for debugging.
export function sanitizeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, '?');
}

// Express request logger. One line per response, fired on `finish` so the
// status code and duration are accurate. Truncates the UA so a hostile
// client can't flood the log with a megabyte-long header, and sanitizes the
// path + UA so they can't inject fake log lines via control characters.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const ip = sanitizeForLog(getClientIp(req, req.headers));
    const path = sanitizeForLog(req.originalUrl).slice(0, 500);
    const ua = sanitizeForLog((req.headers['user-agent'] || '-').toString().slice(0, 200));
    const logLine = `${req.method} ${path} ${res.statusCode} ${duration}ms ip=${ip} ua="${ua.replace(/"/g, '\\"')}"`;
    console.log(logLine);
  });
  next();
}
