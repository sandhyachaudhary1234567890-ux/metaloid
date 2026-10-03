// Provider-secret encryption: envelope format, tamper detection, rotation.
//
// These run the real module in a child process per case, because the keyring
// is read from the environment at first use (exactly as it is in production).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const MOD = path.join(ROOT, 'src', 'crypto.js');

const key = () => crypto.randomBytes(32).toString('base64');

/** Run a snippet with a given keyring and return its JSON result. */
function run(snippet, env = {}) {
  const script = `
    const c = await import(${JSON.stringify(MOD)});
    const out = await (async () => { ${snippet} })();
    process.stdout.write(JSON.stringify(out ?? null));
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env },
  });
  if (res.status !== 0) throw new Error(res.stderr || 'crypto snippet failed');
  return JSON.parse(res.stdout || 'null');
}

test('round-trips a secret and never returns the plaintext from encrypt()', () => {
  const k = key();
  const secret = 'sk-or-v1-abcdef0123456789abcdef0123456789';
  const out = run(`
    const envelope = c.encryptSecret(${JSON.stringify(secret)});
    return { envelope, back: c.decryptSecret(envelope) };
  `, { METALOID_ENCRYPTION_KEYS: `k1:${k}` });

  assert.equal(out.back, secret);
  assert.ok(!out.envelope.includes(secret), 'the envelope must not embed the plaintext');
  assert.match(out.envelope, /^v1:k1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/,
    'versioned, self-describing envelope: v1:<keyId>:<iv>:<tag>:<ciphertext>');
});

test('a fresh IV per call means identical secrets produce different ciphertext', () => {
  const k = key();
  const out = run(`
    const a = c.encryptSecret('same-value');
    const b = c.encryptSecret('same-value');
    return { a, b };
  `, { METALOID_ENCRYPTION_KEYS: `k1:${k}` });
  assert.notEqual(out.a, out.b, 'nonce reuse would break GCM guarantees');
});

test('tampering is detected, never silently decrypted', () => {
  const k = key();
  const out = run(`
    const env = c.encryptSecret('sensitive-value');
    const parts = env.split(':');
    const flipped = Buffer.from(parts[4], 'base64url');
    flipped[0] ^= 0xff;
    parts[4] = flipped.toString('base64url');
    let error = null;
    try { c.decryptSecret(parts.join(':')); } catch (e) { error = e.message; }
    return { error };
  `, { METALOID_ENCRYPTION_KEYS: `k1:${k}` });
  assert.ok(out.error, 'a modified ciphertext must fail authentication');
});

test('a tag from another ciphertext is rejected (no mix-and-match)', () => {
  const k = key();
  const out = run(`
    const a = c.encryptSecret('value-a').split(':');
    const b = c.encryptSecret('value-b').split(':');
    let error = null;
    try { c.decryptSecret([a[0], a[1], a[2], b[3], a[4]].join(':')); } catch (e) { error = e.message; }
    return { error };
  `, { METALOID_ENCRYPTION_KEYS: `k1:${k}` });
  assert.ok(out.error, 'substituting an authentication tag must fail');
});

test('a key that is absent from the keyring cannot decrypt (rotation safety)', () => {
  const k1 = key();
  const k2 = key();
  // phase 1: encrypt with a keyring that only knows k1
  const written = run(`
    return { envelope: c.encryptSecret('written-under-k1') };
  `, { METALOID_ENCRYPTION_KEYS: `k1:${k1}` });

  // phase 2: a keyring that has k2 (and is missing k1) must fail loudly
  const out = run(`
    let error = null;
    try { c.decryptSecret(${JSON.stringify(written.envelope)}); } catch (e) { error = e.message; }
    return { error, info: c.encryptionInfo() };
  `, { METALOID_ENCRYPTION_KEYS: `k2:${k2}` });

  assert.match(out.error, /no encryption key with id "k1"/, 'a missing key must be a loud, specific error');
  assert.equal(out.info.activeKeyId, 'k2');
});

test('rotation: new writes use the active key, old ciphertext still decrypts', () => {
  const k1 = key();
  const k2 = key();
  const out = run(`
    const oldEnvelope = c.encryptSecret('legacy-value');           // active = k1
    return { oldEnvelope };
  `, { METALOID_ENCRYPTION_KEYS: `k1:${k1}` });

  const after = run(`
    const back = c.decryptSecret(${JSON.stringify(out.oldEnvelope)});
    const fresh = c.encryptSecret('new-value');
    const info = c.encryptionInfo();
    return { back, fresh, info };
  `, { METALOID_ENCRYPTION_KEYS: `k1:${k1},k2:${k2}`, METALOID_ENCRYPTION_ACTIVE: 'k2' });

  assert.equal(after.back, 'legacy-value', 'the old key must keep working');
  assert.match(after.fresh, /^v1:k2:/, 'new writes must use the active key');
  assert.deepEqual(after.info.keyIds, ['k1', 'k2']);
  assert.equal(after.info.activeKeyId, 'k2');
});

test('encryption reports itself unconfigured and refuses to store', () => {
  const out = run(`
    let error = null, code = null;
    try { c.encryptSecret('x'); } catch (e) { error = e.message; code = e.code; }
    return { error, code, info: c.encryptionInfo() };
  `, { METALOID_ENCRYPTION_KEYS: '' });
  assert.equal(out.code, 'ENCRYPTION_UNCONFIGURED');
  assert.equal(out.info.configured, false);
});

test('a malformed key fails loudly at load time rather than at 3am', () => {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const c = await import(${JSON.stringify(MOD)}); c.encryptionInfo();`],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, METALOID_ENCRYPTION_KEYS: 'k1:tooshort' } });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /must be 32 bytes/);
});

test('masking reveals only the last 4 characters, and redaction removes key-shaped text', () => {
  const out = run(`
    return {
      mask: c.maskSecret('sk-or-v1-1234567890abcdef'),
      short: c.maskSecret('abc'),
      redacted: c.redact('failed with sk-or-v1-abcdefghijklmnopqrstuvwxyz123456'),
    };
  `, { METALOID_ENCRYPTION_KEYS: `k1:${key()}` });
  assert.equal(out.mask, '…cdef');
  assert.equal(out.short, '…', 'a short secret is not partially revealed');
  assert.ok(!out.redacted.includes('sk-or-v1-abcdefghij'));
  assert.match(out.redacted, /\[redacted\]/);
});
