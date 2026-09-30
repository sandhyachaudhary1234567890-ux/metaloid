// Auth — session tokens for the multi-user gateway.
// Tokens live in localStorage (per-device secret storage lands with the
// companion app). 401 from any gateway call clears the session and raises
// AUTH_REQUIRED so the UI returns to sign-in. Account switching = logout:
// in-memory context is rebuilt from the newly namespaced stores.

export interface AuthUser {
  id: string;
  handle: string;
  displayName: string;
  role: string;
  createdAt: string;
}

interface Session {
  access: string;
  refresh: string;
  user: AuthUser;
}

const K = 'metaloid.session.v1';
let mem: Session | null = null;
let listeners = new Set<() => void>();

function read(): Session | null {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(K);
    if (raw) mem = JSON.parse(raw) as Session;
  } catch {
    mem = null;
  }
  return mem;
}

function write(s: Session | null) {
  mem = s;
  try {
    if (s) localStorage.setItem(K, JSON.stringify(s));
    else localStorage.removeItem(K);
  } catch { /* ignore */ }
  listeners.forEach((fn) => {
    try {
      fn();
    } catch { /* ignore */ }
  });
}

export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSession(): Session | null {
  return read();
}

export function getAccessToken(): string | null {
  return read()?.access || null;
}

export function getAuthUser(): AuthUser | null {
  return read()?.user || null;
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = getAccessToken();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : { ...extra };
}

export function setSession(s: Session) {
  write(s);
}

export function clearSession() {
  write(null);
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Sign in required.');
    this.name = 'AuthRequiredError';
  }
}

/** Throw on 401 after clearing the session — callers surface sign-in UI. */
export function throwIfAuth(res: Response, body: { code?: string } | null) {
  if (res.status === 401 || body?.code === 'AUTH_REQUIRED') {
    clearSession();
    throw new AuthRequiredError();
  }
}
