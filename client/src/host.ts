// Per-room host claim and login client. The server treats one host per
// room with a password set the first time someone claims it; this module
// handles the API calls and the localStorage cache of the issued token.
//
// No host actions are wired up yet — this is just the identity layer.
// Future host endpoints will read the stored token via Authorization:
// Bearer <token>; see getStoredHostToken().

const TOKEN_PREFIX = 'collabjs_host_token_';

export interface HostStatus {
  claimed: boolean;
  available: boolean;
  // True only if the caller passed a Bearer token that's still valid for
  // this room. Lets the client reconcile localStorage with server state on
  // every load (a token may have been revoked elsewhere).
  authed: boolean;
}

export type ClaimResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'conflict' | 'invalid' | 'unavailable' | 'network' };

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'unauthorized' | 'unavailable' | 'invalid' | 'network' };

function tokenKey(roomId: string): string {
  return TOKEN_PREFIX + roomId;
}

export function getStoredHostToken(roomId: string): string | null {
  return localStorage.getItem(tokenKey(roomId));
}

export function storeHostToken(roomId: string, token: string): void {
  localStorage.setItem(tokenKey(roomId), token);
}

export function clearHostToken(roomId: string): void {
  localStorage.removeItem(tokenKey(roomId));
}

export async function fetchHostStatus(
  roomId: string,
  token?: string | null
): Promise<HostStatus> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/host`, {
      headers,
    });
    if (!res.ok) return { claimed: false, available: false, authed: false };
    const body = await res.json();
    return {
      claimed: body?.claimed === true,
      available: body?.available === true,
      authed: body?.authed === true,
    };
  } catch {
    return { claimed: false, available: false, authed: false };
  }
}

export async function claimHost(roomId: string, password: string): Promise<ClaimResult> {
  let res: Response;
  try {
    res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (res.status === 201) {
    const body = await res.json();
    return { ok: true, token: String(body.token) };
  }
  if (res.status === 409) return { ok: false, reason: 'conflict' };
  if (res.status === 400) return { ok: false, reason: 'invalid' };
  if (res.status === 503) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'network' };
}

export async function loginHost(roomId: string, password: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/host-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (res.ok) {
    const body = await res.json();
    return { ok: true, token: String(body.token) };
  }
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 400) return { ok: false, reason: 'invalid' };
  if (res.status === 503) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'network' };
}

// Failure shape is shared between logout-all and nuke (both go through
// requireHost); only the success shapes differ.
type HostActionFailure = {
  ok: false;
  reason: 'unauthorized' | 'forbidden' | 'unavailable' | 'network' | 'server';
};

export type LogoutAllResult = { ok: true } | HostActionFailure;
export type NukeResult = { ok: true; nextRoomId: string } | HostActionFailure;

// Per-user activity aggregates for the dashboard detail pane. Keyed by
// username (same caveat as the server: renames split stats). Timestamps
// are ISO strings straight off the wire.
export interface RoomUserStats {
  username: string;
  keystrokes: number;
  firstActive: string;
  lastActive: string;
}

export type RoomStatsResult =
  | { ok: true; stats: RoomUserStats[] }
  | HostActionFailure;

export async function fetchRoomStats(
  roomId: string,
  token: string
): Promise<RoomStatsResult> {
  let res: Response;
  try {
    res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/host/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (res.ok) {
    try {
      const body = await res.json();
      if (Array.isArray(body?.stats)) {
        const stats: RoomUserStats[] = [];
        for (const row of body.stats) {
          if (
            typeof row?.username !== 'string' ||
            typeof row?.keystrokes !== 'number' ||
            !Number.isFinite(row.keystrokes) ||
            typeof row?.firstActive !== 'string' ||
            typeof row?.lastActive !== 'string'
          ) {
            return { ok: false, reason: 'server' };
          }
          stats.push({
            username: row.username,
            keystrokes: row.keystrokes,
            firstActive: row.firstActive,
            lastActive: row.lastActive,
          });
        }
        return { ok: true, stats };
      }
    } catch {
      // fall through to server error
    }
    return { ok: false, reason: 'server' };
  }
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 403) return { ok: false, reason: 'forbidden' };
  if (res.status === 503) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'server' };
}

// Mirror of the server-side room-id regex. Used at every parse boundary that
// hands an untrusted string to navigation so a buggy or hostile server (or a
// stateless message tampered with elsewhere) can't redirect us somewhere
// unexpected.
const ROOM_ID_RE = /^[a-zA-Z0-9-]{1,128}$/;

export async function logoutAllHostSessions(roomId: string, token: string): Promise<LogoutAllResult> {
  let res: Response;
  try {
    res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/host/logout-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.status === 204) return { ok: true };
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 403) return { ok: false, reason: 'forbidden' };
  if (res.status === 503) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'server' };
}

// Payload shapes of stateless messages the server broadcasts for host events.
//   room-nuked        — room is being deleted; navigate to /room/<nextRoomId>
//                       so every tab lands together in a fresh room and the
//                       local Y.Doc is dropped (CRDT auto-sync would otherwise
//                       push pre-nuke content into the empty server doc).
//   host-state-changed — claim/login/logout-all happened; refetch host status
//                        and update the UI without reloading.
export type HostStatelessMessage =
  | { type: 'room-nuked'; nextRoomId: string }
  | { type: 'host-state-changed' };

export function parseHostStatelessMessage(payload: string): HostStatelessMessage | null {
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.type === 'room-nuked') {
      const nextRoomId = parsed?.nextRoomId;
      if (typeof nextRoomId === 'string' && ROOM_ID_RE.test(nextRoomId)) {
        return { type: 'room-nuked', nextRoomId };
      }
      return null;
    }
    if (parsed?.type === 'host-state-changed') return { type: 'host-state-changed' };
    return null;
  } catch {
    return null;
  }
}

export async function nukeRoom(roomId: string, token: string): Promise<NukeResult> {
  let res: Response;
  try {
    res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (res.status === 200) {
    try {
      const body = await res.json();
      const nextRoomId = body?.nextRoomId;
      if (typeof nextRoomId === 'string' && ROOM_ID_RE.test(nextRoomId)) {
        return { ok: true, nextRoomId };
      }
    } catch {
      // fall through to server error
    }
    return { ok: false, reason: 'server' };
  }
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 403) return { ok: false, reason: 'forbidden' };
  if (res.status === 503) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'server' };
}
