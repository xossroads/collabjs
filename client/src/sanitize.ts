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
// validate at consumption — our own renderers call sanitizeRemoteUser, and
// yCollab reads through createEditorAwareness below.

import type { Awareness } from 'y-protocols/awareness';
import { themedUserColors } from './colors';

const NAME_MAX_LEN = 64;
const FALLBACK_NAME = 'unknown';
const FALLBACK_COLOR = 'hsl(0, 0%, 50%)';

// Accept the HSL format the project actually generates (username.ts) and
// hex colors. Anything else falls back to a neutral grey.
const COLOR_RE = /^(?:hsl\(\d{1,3},\s*\d{1,3}%,\s*\d{1,3}%\)|#[0-9a-fA-F]{3,8})$/;

// The localStorage UUID a peer broadcasts so the host dashboard can match
// them to their activity stats. Anything that isn't UUID-shaped becomes null
// (the dashboard falls back to matching by name).
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SafeUser {
  name: string;
  color: string;
  clientId: string | null;
}

export function sanitizeRemoteUser(value: unknown): SafeUser {
  const raw = (value ?? {}) as { name?: unknown; color?: unknown; clientId?: unknown };

  const name =
    typeof raw.name === 'string' && raw.name.length > 0
      ? raw.name.slice(0, NAME_MAX_LEN)
      : FALLBACK_NAME;

  const color =
    typeof raw.color === 'string' && COLOR_RE.test(raw.color)
      ? raw.color
      : FALLBACK_COLOR;

  const clientId =
    typeof raw.clientId === 'string' && CLIENT_ID_RE.test(raw.clientId)
      ? raw.clientId
      : null;

  return { name, color, clientId };
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

// The awareness that the editor's collaboration layer (yCollab) and the
// mouse cursors read from: the real one, except getStates() returns cleaned
// copies of remote states — sanitized user, theme-lit colors (see
// themedUserColors), and no malformed cursor. The shared states themselves
// are never modified: y-protocols decides whether an incoming update is a
// 'change' by deep-comparing it with the stored state, so rewriting stored
// states made every 15s presence heartbeat look like a change.
//
// Only the members those two consumers use are provided.
export interface EditorAwareness {
  awareness: Awareness;
  setEditorDark(isDark: boolean): void;
}

export function createEditorAwareness(awareness: Awareness, editorIsDark: boolean): EditorAwareness {
  let dark = editorIsDark;
  // Cleaned copy per stored state object; a peer's update replaces the
  // object, which naturally invalidates its entry.
  const cache = new WeakMap<object, { dark: boolean; clean: Record<string, unknown> }>();

  const clean = (state: Record<string, unknown>): Record<string, unknown> => {
    const hit = cache.get(state);
    if (hit && hit.dark === dark) return hit.clean;
    const out: Record<string, unknown> = { ...state };
    if ('user' in state) {
      const user = sanitizeRemoteUser(state.user);
      out.user = { ...user, ...themedUserColors(user.color, dark) };
    }
    if (!isSafeCursor(state.cursor)) delete out.cursor;
    cache.set(state, { dark, clean: out });
    return out;
  };

  const view = {
    get doc() {
      return awareness.doc;
    },
    get clientID() {
      return awareness.clientID;
    },
    getLocalState: () => awareness.getLocalState(),
    setLocalStateField: (field: string, value: unknown) => awareness.setLocalStateField(field, value),
    getStates: () => {
      const states = new Map<number, Record<string, unknown>>();
      awareness.getStates().forEach((state, id) => {
        states.set(id, id === awareness.clientID ? state : clean(state));
      });
      return states;
    },
    on: (name: string, fn: (...args: any[]) => void) => awareness.on(name, fn),
    off: (name: string, fn: (...args: any[]) => void) => awareness.off(name, fn),
  };

  return {
    awareness: view as unknown as Awareness,
    // Takes effect on the next read; the caller redraws (the theme
    // reconfigure makes yCollab rebuild its decorations).
    setEditorDark(isDark: boolean) {
      dark = isDark;
    },
  };
}
