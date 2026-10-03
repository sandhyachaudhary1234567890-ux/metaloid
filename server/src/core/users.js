// Identity layer — users, sessions, auth middleware.
// ONE product, isolated per-user instances. Every session resolves to
// { userId, accountId (=userId, single-account model), sessionId, deviceId }.
// Secrets: scrypt-hashed passcodes, sha256-hashed tokens (raw tokens are
// never persisted). Short-lived access (30m) + rotating refresh (30d).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';
import { authConfigured } from '../auth.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const USERS_FILE = path.join(DIR, 'users.json');
const SESSIONS_FILE = path.join(DIR, 'sessions.json');

export const ACCESS_TTL_MS = Number(process.env.METALOID_ACCESS_TTL_MS || 30 * 60 * 1000);
export const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

function load(file, fallback) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* start empty */ }
  return fallback;
}
function save(file, obj, cap = 2_000_000) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 1).slice(0, cap));
  } catch { /* disk full — state stays in RAM */ }
}

let users = load(USERS_FILE, { users: [] });
let sessions = load(SESSIONS_FILE, { sessions: [] });

const persistUsers = () => save(USERS_FILE, users);
const persistSessions = () => save(SESSIONS_FILE, sessions, 5_000_000);

const uid = (p) => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (p) => `${p}_${crypto.randomBytes(24).toString('base64url')}`;

function hashPasscode(passcode, salt) {
  return crypto.scryptSync(String(passcode), salt, 32).toString('hex');
}

function publicUser(u) {
  const { passHash, salt, ...rest } = u;
  void passHash; void salt;
  return rest;
}

// ---------- accounts ----------

export function userCount() {
  return users.users.length;
}

export function findUserByHandle(handle) {
  const h = String(handle || '').trim().toLowerCase();
  return users.users.find((u) => u.handle === h) || null;
}

export function getUser(id) {
  return users.users.find((u) => u.id === id) || null;
}

/** First account on a fresh gateway becomes admin (debug + user admin). */
export function createUser({ handle, displayName, passcode }) {
  const h = String(handle || '').trim().toLowerCase().slice(0, 40);
  const name = String(displayName || '').trim().slice(0, 40) || h;
  const pc = String(passcode || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(h)) return { ok: false, error: 'Handle: 3–40 chars, letters/numbers/._- only.' };
  if (pc.length < 4 || pc.length > 128) return { ok: false, error: 'Passcode: 4+ characters.' };
  if (findUserByHandle(h)) return { ok: false, error: 'That handle is taken.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const u = {
    id: uid('usr'), accountId: null,
    handle: h, displayName: name,
    passHash: hashPasscode(pc, salt), salt,
    role: users.users.length === 0 ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
  };
  u.accountId = u.id;
  users.users.push(u);
  persistUsers();
  emit('user.created', { id: u.id, handle: h, role: u.role });
  return { ok: true, user: publicUser(u) };
}

export function verifyUser(handle, passcode) {
  const u = findUserByHandle(handle);
  if (!u) return { ok: false, error: 'Unknown handle or wrong passcode.' };
  const h = hashPasscode(passcode, u.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.passHash, 'hex'))) {
    emit('security.login_failed', { handle: u.handle });
    return { ok: false, error: 'Unknown handle or wrong passcode.' };
  }
  return { ok: true, user: u };
}

// ---------- sessions ----------

function pruneSessions() {
  const now = Date.now();
  const before = sessions.sessions.length;
  sessions.sessions = sessions.sessions.filter((s) => s.refreshExpiresAt > now);
  if (sessions.sessions.length !== before) persistSessions();
}

export function createSession(userId, { deviceId = null, deviceName = '' } = {}) {
  pruneSessions();
  const now = Date.now();
  const access = rand('mta');
  const refresh = rand('mtr');
  const s = {
    id: uid('ses'), userId,
    deviceId: typeof deviceId === 'string' && deviceId ? deviceId.slice(0, 80) : null,
    deviceName: String(deviceName || '').slice(0, 80),
    accessHash: sha(access), refreshHash: sha(refresh),
    createdAt: new Date(now).toISOString(),
    accessExpiresAt: now + ACCESS_TTL_MS,
    refreshExpiresAt: now + REFRESH_TTL_MS,
  };
  sessions.sessions.push(s);
  if (sessions.sessions.length > 500) sessions.sessions.splice(0, sessions.sessions.length - 500);
  persistSessions();
  emit('user.session_created', { user: userId, session: s.id });
  return { access, refresh, session: publicSession(s) };
}

function publicSession(s) {
  const { accessHash, refreshHash, ...rest } = s;
  void accessHash; void refreshHash;
  return rest;
}

export function validateAccess(token) {
  pruneSessions();
  const s = sessions.sessions.find((x) => x.accessHash === sha(token));
  if (!s || s.accessExpiresAt <= Date.now()) return null;
  if (!getUser(s.userId)) return null;
  return { userId: s.userId, accountId: s.userId, sessionId: s.id, deviceId: s.deviceId };
}

export function refreshSession(refreshToken) {
  pruneSessions();
  const s = sessions.sessions.find((x) => x.refreshHash === sha(refreshToken));
  if (!s || s.refreshExpiresAt <= Date.now()) return null;
  if (!getUser(s.userId)) return null;
  // rotation: old refresh dies, new pair issued on the SAME session
  const access = rand('mta');
  const refresh = rand('mtr');
  const now = Date.now();
  s.accessHash = sha(access);
  s.refreshHash = sha(refresh);
  s.accessExpiresAt = now + ACCESS_TTL_MS;
  persistSessions();
  return { access, refresh, session: publicSession(s) };
}

export function revokeSession(sessionId, userId) {
  const i = sessions.sessions.findIndex((s) => s.id === sessionId && s.userId === userId);
  if (i < 0) return false;
  sessions.sessions.splice(i, 1);
  persistSessions();
  emit('user.session_revoked', { session: sessionId });
  return true;
}

/** Logout everywhere: kills every session of this user. */
export function revokeAllSessions(userId) {
  const before = sessions.sessions.length;
  sessions.sessions = sessions.sessions.filter((s) => s.userId !== userId);
  persistSessions();
  emit('user.sessions_revoked_all', { user: userId, count: before - sessions.sessions.length });
  return before - sessions.sessions.length;
}

export function listSessions(userId) {
  pruneSessions();
  return sessions.sessions.filter((s) => s.userId === userId).map(publicSession);
}

export function deleteUserCascade(userId) {
  users.users = users.users.filter((u) => u.id !== userId);
  persistUsers();
  revokeAllSessions(userId);
  emit('user.deleted', { user: userId });
  return true;
}

// ---------- express middleware ----------

const LOCAL_AUTH = { userId: 'local:owner', accountId: 'local:owner', sessionId: 'local', deviceId: null, role: 'owner', via: 'local' };

/** Explicit production disables the local fallback; showcase/opt-in enables it
 *  anywhere; otherwise it applies only to a same-machine caller when no auth
 *  backend is configured at all. */
function localOpenMode(req) {
  if (process.env.METALOID_MODE === 'production') return false;
  // A hosted platform is never somebody's development machine. Vercel's own
  // marker is checked here so the fallback cannot depend on remembering to set
  // METALOID_MODE: a deployment that forgot it, and whose verifier is missing
  // or misspelled, would otherwise fall through to the loopback test below —
  // and behind a reverse proxy a loopback-looking remote address is not a
  // strong guarantee. The consequence of getting this wrong is that /api/chat
  // becomes an anonymous route to the platform's provider key, so it fails
  // closed. Local development, which never sets VERCEL, is unaffected.
  if (process.env.VERCEL) return false;
  if (process.env.METALOID_MODE === 'showcase' || process.env.METALOID_ALLOW_ANONYMOUS === 'true') return true;
  // Ask auth.js, which is the module that actually verifies tokens. This used
  // to re-derive the answer from a hand-written list of env var names, and it
  // named the public key SUPABASE_PUBLIC_KEY_PEM while auth.js reads
  // SUPABASE_JWT_PUBLIC_KEY. A deployment configured with only the key auth.js
  // uses therefore looked *unconfigured* here and could hand a same-host caller
  // the local owner identity — an anonymous route to the platform's provider
  // credits on a server that was in fact fully configured.
  if (authConfigured()) return false;
  const ip = String((req.socket && req.socket.remoteAddress) || '');
  return ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.');
}

/** Attaches req.auth or rejects 401. Never trusts frontend ownership claims.
 * Local sessions first (fast path); Supabase Auth JWTs accepted as fallback
 * so Supabase-authenticated users work end-to-end. Supabase user ids are
 * namespaced `sb:<uuid>` to never collide with local `usr-…` ids. */
export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  const auth = token ? validateAccess(token) : null;
  if (auth) {
    req.auth = auth;
    return next();
  }
  if (!token && localOpenMode(req)) {
    // Local dev/demo only: no auth backend is configured and the caller is on
    // this machine (or the operator explicitly asked for showcase), so
    // owner-scoped routes run under one local identity instead of 401ing.
    // A network caller NEVER takes this path, and METALOID_MODE=production
    // disables it outright — that is what keeps a deployed gateway from
    // becoming an anonymous proxy for the owner's provider key.
    req.auth = LOCAL_AUTH;
    return next();
  }
  if (token) {
    try {
      // ONE Supabase verifier for the whole server: server/src/auth.js checks
      // the JWT (JWKS / public key / HS256 secret) and returns the raw Supabase
      // user id, which is also what RLS compares against auth.uid().
      const { verifyToken } = await import('../auth.js');
      const su = await verifyToken(token);
      if (su && su.id) {
        req.auth = { userId: su.id, accountId: su.id, sessionId: 'sb-session', deviceId: null, via: 'supabase', email: su.email };
        return next();
      }
    } catch { /* fall through to 401 */ }
  }
  return res.status(401).json({ error: 'Sign in required.', code: 'AUTH_REQUIRED' });
}

/** Attaches req.auth from Bearer token if valid, otherwise falls back to guest context. */
export function optionalAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const auth = m ? validateAccess(m[1].trim()) : null;
  req.auth = auth || { userId: 'guest', role: 'guest', sessionId: 'guest' };
  next();
}

/** Admin-only (first account / explicitly promoted). Debug surfaces only. */
export function requireAdmin(req, res, next) {
  const u = getUser(req.auth.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  next();
}

/**
 * Ownership gate at the data-access boundary.
 * Returns the object when owned by the caller, else null (caller maps to
 * 404 so IDs can neither be enumerated nor distinguished from missing).
 */
export function ownedBy(obj, userId) {
  if (!obj) return null;
  const owner = obj.userId || obj.ownerId || null;
  if (owner !== userId) return null;
  return obj;
}
