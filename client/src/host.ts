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

export type NukeResult =
  | { ok: true }
  | { ok: false; reason: 'unauthorized' | 'forbidden' | 'unavailable' | 'network' | 'server' };

export async function logoutAllHostSessions(roomId: string, token: string): Promise<NukeResult> {
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
//   room-nuked        — room is being deleted; reload to drop local Y.Doc.
//   host-state-changed — claim/login/logout-all happened; refetch host status
//                        and update the UI without reloading.
export type HostStatelessMessage =
  | { type: 'room-nuked' }
  | { type: 'host-state-changed' };

export function parseHostStatelessMessage(payload: string): HostStatelessMessage | null {
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.type === 'room-nuked') return { type: 'room-nuked' };
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

  if (res.status === 204) return { ok: true };
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 403) return { ok: false, reason: 'forbidden' };
  if (res.status === 503) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'server' };
}
