// Sanitize remote awareness values before consuming them. The HTML username
// input has `maxlength="20"`, but that's a UX hint — a malicious client can
// bypass it (set localStorage directly, drive Y.js awareness from DevTools)
// and broadcast arbitrary strings to every other room participant.
//
// The cursor and user-list renderers already use textContent / DOM APIs, so
// these values can't execute code. The remaining risk is bandwidth, RAM,
// and layout: a 10MB name would fan out to every peer, blow up Y.js sync
// payloads, and tank rendering. Cap and validate at consumption.

const NAME_MAX_LEN = 64;
const FALLBACK_NAME = 'unknown';
const FALLBACK_COLOR = 'hsl(0, 0%, 50%)';

// Accept the HSL format the project actually generates (username.ts) and
// hex colors. Anything else falls back to a neutral grey.
const COLOR_RE = /^(?:hsl\(\d{1,3},\s*\d{1,3}%,\s*\d{1,3}%\)|#[0-9a-fA-F]{3,8})$/;

export interface SafeUser {
  name: string;
  color: string;
}

export function sanitizeRemoteUser(value: unknown): SafeUser {
  const raw = (value ?? {}) as { name?: unknown; color?: unknown };

  const name =
    typeof raw.name === 'string' && raw.name.length > 0
      ? raw.name.slice(0, NAME_MAX_LEN)
      : FALLBACK_NAME;

  const color =
    typeof raw.color === 'string' && COLOR_RE.test(raw.color)
      ? raw.color
      : FALLBACK_COLOR;

  return { name, color };
}
