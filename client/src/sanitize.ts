// Sanitize remote awareness values before consuming them. The HTML username
// input has `maxlength="20"`, but that's a UX hint — a malicious client can
// bypass it (set localStorage directly, drive Y.js awareness from DevTools)
// and broadcast arbitrary strings to every other room participant.
//
// The cursor and user-list renderers already use textContent / DOM APIs, so
// these values can't execute code. The remaining risks are bandwidth, RAM,
// and layout (a 10MB name fans out to every peer and tanks rendering), and
// CSS injection: y-codemirror.next interpolates color/colorLight straight
// into inline style attributes on remote carets and selections. Cap and
// validate at consumption.

import type { Awareness } from 'y-protocols/awareness';

const NAME_MAX_LEN = 64;
const FALLBACK_NAME = 'unknown';
const FALLBACK_COLOR = 'hsl(0, 0%, 50%)';

// Accept the HSL format the project actually generates (username.ts) and
// hex colors. Anything else falls back to a neutral grey.
const COLOR_RE = /^(?:hsl\(\d{1,3},\s*\d{1,3}%,\s*\d{1,3}%\)|#[0-9a-fA-F]{3,8})$/;

// Selection-highlight color: the hsla() form getUserColorLight() generates,
// or hex. Anything else is derived from the (already validated) color.
const COLOR_LIGHT_RE =
  /^(?:hsla\(\d{1,3},\s*\d{1,3}%,\s*\d{1,3}%,\s*(?:0|1|0?\.\d{1,3})\)|#[0-9a-fA-F]{3,8})$/;

function deriveColorLight(color: string): string {
  if (color.startsWith('hsl(')) return color.replace(/^hsl\((.*)\)$/, 'hsla($1, 0.2)');
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color + '33';
  return 'hsla(0, 0%, 50%, 0.2)';
}

// The localStorage UUID a peer broadcasts so the host dashboard can match
// them to their activity stats. Anything that isn't UUID-shaped becomes null
// (the dashboard falls back to matching by name).
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SafeUser {
  name: string;
  color: string;
  colorLight: string;
  clientId: string | null;
}

export function sanitizeRemoteUser(value: unknown): SafeUser {
  const raw = (value ?? {}) as {
    name?: unknown;
    color?: unknown;
    colorLight?: unknown;
    clientId?: unknown;
  };

  const name =
    typeof raw.name === 'string' && raw.name.length > 0
      ? raw.name.slice(0, NAME_MAX_LEN)
      : FALLBACK_NAME;

  const color =
    typeof raw.color === 'string' && COLOR_RE.test(raw.color)
      ? raw.color
      : FALLBACK_COLOR;

  const colorLight =
    typeof raw.colorLight === 'string' && COLOR_LIGHT_RE.test(raw.colorLight)
      ? raw.colorLight
      : deriveColorLight(color);

  const clientId =
    typeof raw.clientId === 'string' && CLIENT_ID_RE.test(raw.clientId)
      ? raw.clientId
      : null;

  return { name, color, colorLight, clientId };
}

// y-codemirror.next feeds cursor.anchor/head to
// Y.createRelativePositionFromJSON; anything that isn't a pair of objects
// is dropped so a malformed cursor can't break caret rendering.
function isSafeCursor(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  const raw = value as { anchor?: unknown; head?: unknown };
  return (
    typeof raw.anchor === 'object' && raw.anchor !== null &&
    typeof raw.head === 'object' && raw.head !== null
  );
}

// Sanitize every remote awareness state in place as it arrives, so consumers
// we don't control (y-codemirror.next's caret/selection widgets) only ever
// see clean values. Must be registered before those consumers: Awareness
// emits 'change' to listeners in registration order, and yCollab renders
// synchronously from its listener. Remote state objects are never
// re-broadcast by us, so mutating them is safe.
export function sanitizeRemoteAwareness(awareness: Awareness): void {
  awareness.on(
    'change',
    ({ added, updated }: { added: number[]; updated: number[] }) => {
      const states = awareness.getStates();
      for (const id of [...added, ...updated]) {
        if (id === awareness.clientID) continue;
        const state = states.get(id);
        if (!state) continue;
        if ('user' in state) state.user = sanitizeRemoteUser(state.user);
        if (!isSafeCursor(state.cursor)) delete state.cursor;
      }
    }
  );
}
