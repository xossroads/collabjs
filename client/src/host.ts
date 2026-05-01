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

export async function fetchHostStatus(roomId: string): Promise<HostStatus> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/host`);
    if (!res.ok) return { claimed: false, available: false };
    const body = await res.json();
    return {
      claimed: body?.claimed === true,
      available: body?.available === true,
    };
  } catch {
    return { claimed: false, available: false };
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
