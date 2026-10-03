// Provider-secret encryption.
//
// Stored ciphertext is a self-describing, versioned envelope:
//
//     v1:<keyId>:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>
//
// Why each piece exists:
//   v1        — the format version, so a future scheme can be parsed apart
//   keyId     — which key encrypted it, which is what makes rotation possible
//               (decrypt with the matching key; re-encrypt on next write)
//   iv        — 96-bit random nonce, unique per encryption. Never reused:
//               GCM loses its guarantees if a nonce repeats under one key.
//   tag       — GCM authentication tag: tampering fails loudly, never
//               silently returns wrong plaintext
//
// The key never lives in code. It comes from the environment (a secret
// manager in production) as METALOID_ENCRYPTION_KEYS:
//
//     METALOID_ENCRYPTION_KEYS="k2:<base64-32-bytes>,k1:<base64-32-bytes>"
//     METALOID_ENCRYPTION_ACTIVE=k2          # optional, defaults to the first
//
// Old keys stay listed until every row has been re-encrypted, so rotation is
// a config change plus a backfill — never a flag day.

import crypto from 'node:crypto';

const FORMAT_VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;

let keyring = null;
let activeKeyId = null;

function decodeKey(raw, id) {
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`encryption key "${id}" must be ${KEY_BYTES} bytes of base64 (got ${buf.length})`);
  }
  return buf;
}

/**
 * Parse the keyring. Throws on a malformed key — failing at boot is far
 * better than discovering at 3am that secrets cannot be decrypted.
 */
function loadKeyring() {
  if (keyring) return keyring;
  const raw = (process.env.METALOID_ENCRYPTION_KEYS || '').trim();
  if (!raw) {
    keyring = new Map();
    activeKeyId = null;
    return keyring;
  }
  const map = new Map();
  for (const part of raw.split(',')) {
    const [id, ...rest] = part.trim().split(':');
    const value = rest.join(':');
    if (!id || !value) throw new Error('METALOID_ENCRYPTION_KEYS entry must look like "k1:<base64>"');
    map.set(id, decodeKey(value, id));
  }
  if (!map.size) throw new Error('METALOID_ENCRYPTION_KEYS is set but contains no usable key');
  keyring = map;
  const preferred = (process.env.METALOID_ENCRYPTION_ACTIVE || '').trim();
  activeKeyId = preferred && map.has(preferred) ? preferred : [...map.keys()][0];
  return keyring;
}

export function encryptionConfigured() {
  return loadKeyring().size > 0;
}

/** Key ids present, and which one new writes use. Never exposes key bytes. */
export function encryptionInfo() {
  const ring = loadKeyring();
  return { configured: ring.size > 0, activeKeyId, keyIds: [...ring.keys()] };
}

function requireKey(id) {
  const ring = loadKeyring();
  const key = ring.get(id);
  if (!key) throw new Error(`no encryption key with id "${id}" in the keyring (rotation key missing?)`);
  return key;
}

/** Encrypt a UTF-8 string. Returns the versioned envelope. */
export function encryptSecret(plaintext) {
  const ring = loadKeyring();
  if (!ring.size) {
    const e = new Error('Encryption is not configured (METALOID_ENCRYPTION_KEYS is empty).');
    e.code = 'ENCRYPTION_UNCONFIGURED';
    throw e;
  }
  const id = activeKeyId;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, requireKey(id), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION, id,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join(':');
}

/**
 * Decrypt an envelope. Throws on tampering, truncation, unknown version or
 * a missing key — never returns partial or unauthenticated plaintext.
 */
export function decryptSecret(envelope) {
  const parts = String(envelope || '').split(':');
  if (parts.length !== 5) throw new Error('malformed secret envelope');
  const [version, keyId, ivB64, tagB64, ctB64] = parts;
  if (version !== FORMAT_VERSION) throw new Error(`unsupported secret envelope version "${version}"`);
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('malformed secret envelope');
  const decipher = crypto.createDecipheriv(ALGO, requireKey(keyId), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Which key id produced this envelope (for rotation reporting). */
export function envelopeKeyId(envelope) {
  const parts = String(envelope || '').split(':');
  return parts.length === 5 && parts[0] === FORMAT_VERSION ? parts[1] : null;
}

/**
 * Last 4 characters only — enough for a human to recognise which key is
 * stored, useless for anyone trying to reconstruct it. Short keys are
 * masked entirely.
 */
export function maskSecret(plaintext) {
  const s = String(plaintext || '');
  if (s.length <= 8) return '…';
  return `…${s.slice(-4)}`;
}

/** Never let a secret reach a log line. */
const SECRET_SHAPED = /(sk-or-v1-|nvapi-|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;
export function redact(value) {
  return String(value ?? '').replace(SECRET_SHAPED, '[redacted]');
}
