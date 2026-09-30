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

/** Attaches req.auth or rejects 401. Never trusts frontend ownership claims. */
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const auth = m ? validateAccess(m[1].trim()) : null;
  if (!auth) return res.status(401).json({ error: 'Sign in required.', code: 'AUTH_REQUIRED' });
  req.auth = auth;
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
