// Authenticated product API — identity, ownership, secrets and persistence.
//
// These tests run the REAL route layer, the REAL repositories and the REAL
// crypto, with two signed identities (user A and user B). What they prove:
//
//   * an unauthenticated or forged token reaches no data at all
//   * user A cannot read, write, rename or delete user B's anything
//   * a raw provider key never appears in a response, and never on disk
//   * onboarding / provider / model settings persist per account
//   * account deletion removes the account's data and nobody else's
//
// They use the local driver so the suite needs no network; the Supabase
// driver implements the same interface, and the RLS layer behind it is
// tested separately in supabase/tests/rls_test.sql.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SignJWT, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// One key pair for the whole file: the gateway verifies with the public half,
// the tests sign with the private half — a real cryptographic check, not a
// stubbed middleware.
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const PUBLIC_PEM = await exportSPKI(publicKey);
const PRIVATE_PEM = await exportPKCS8(privateKey);

const ENC_KEY = crypto.randomBytes(32).toString('base64');
const ENC_KEY_OLD = crypto.randomBytes(32).toString('base64');

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

async function mint(sub, { email = `${sub.slice(0, 4)}@example.test`, expiresIn = '1h', audience = 'authenticated' } = {}) {
  const key = await crypto.subtle.importKey('pkcs8', pemToBuffer(PRIVATE_PEM), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return new SignJWT({ role: 'authenticated', email })
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(sub)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

function pemToBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

function port() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port: p } = srv.address();
      srv.close(() => resolve(p));
    });
  });
}

async function waitFor(url, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

/** Boot a gateway with a throwaway local data file and a test identity. */
async function boot(opts = {}) {
  const gatewayPort = await port();
  const dataDir = fs.mkdtempSync(path.join('/tmp', 'metaloid-test-'));
  const env = {
    ...process.env,
      METALOID_NO_DOTENV: '1',
    PORT: String(gatewayPort),
    BIND_HOST: '127.0.0.1',
    OPENROUTER_API_KEY: 'test-key-0123456789',
    OPENROUTER_BASE: 'http://127.0.0.1:1/api/v1', // catalogue unreachable → deterministic
    NVIDIA_ENABLED: 'false',
    METALOID_DATA_DIR: dataDir,
    SUPABASE_JWT_PUBLIC_KEY: PUBLIC_PEM,
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    ...(opts.noEncryption ? {} : { METALOID_ENCRYPTION_KEYS: `k1:${ENC_KEY}` }),
    ...opts.env,
  };
  if (opts.noEncryption) delete env.METALOID_ENCRYPTION_KEYS;

  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  await waitFor(`http://127.0.0.1:${gatewayPort}/api/health`);

  const api = async (method, path_, { token, body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}${path_}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  };

  return {
    port: gatewayPort,
    api,
    logs,
    dataDir,
    readStore() {
      // the local driver flushes asynchronously; wait for it silently
      const file = path.join(dataDir, 'local-store.json');
      try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
    },
    stop() { try { child.kill('SIGKILL'); } catch { /* gone */ } },
  };
}

const tokenA = await mint(USER_A);
const tokenB = await mint(USER_B);

// ═══════════════════════ auth boundary ════════════════════════════════

test('protected routes reject missing, malformed and expired sessions', async () => {
  const g = await boot();
  try {
    const missing = await g.api('GET', '/api/v1/me');
    assert.equal(missing.status, 401);
    assert.equal(missing.json.code, 'no_token');

    const garbage = await g.api('GET', '/api/v1/me', { token: 'not-a-jwt' });
    assert.equal(garbage.status, 401);
    assert.equal(garbage.json.code, 'invalid_token');

    // signed with the wrong key: a valid-looking JWT that must still fail
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(USER_A).setAudience('authenticated').setIssuedAt().setExpirationTime('1h')
      .sign(await generateKeyPair('ES256', { extractable: true }).then((p) => p.privateKey));
    const forgedRes = await g.api('GET', '/api/v1/me', { token: forged });
    assert.equal(forgedRes.status, 401, 'a token signed by another key must not be accepted');

    const expired = await mint(USER_A, { expiresIn: '-1m' });
    const expiredRes = await g.api('GET', '/api/v1/me', { token: expired });
    assert.equal(expiredRes.status, 401);
    assert.equal(expiredRes.json.code, 'token_expired');

    const wrongAudience = await mint(USER_A, { audience: 'anon' });
    const audRes = await g.api('GET', '/api/v1/me', { token: wrongAudience });
    assert.equal(audRes.status, 401, 'the anon audience must not unlock user routes');
  } finally { g.stop(); }
});

test('identity comes from the token, not from the request body', async () => {
  const g = await boot();
  try {
    // A tries to create a conversation "as" B by supplying another user_id
    const res = await g.api('POST', '/api/v1/conversations', {
      token: tokenA,
      body: { title: 'spoof attempt', user_id: USER_B },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.conversation.user_id, USER_A, 'user_id in the body must be ignored');

    // and B still cannot see it
    const listB = await g.api('GET', '/api/v1/conversations', { token: tokenB });
    assert.equal(listB.status, 200);
    assert.equal(listB.json.rows.length, 0, 'the spoofed owner must not gain access');
  } finally { g.stop(); }
});

// ═══════════════════════ cross-user isolation ═════════════════════════

test('critical: user A cannot read or modify user B conversation', async () => {
  const g = await boot();
  try {
    const created = await g.api('POST', '/api/v1/conversations', { token: tokenB, body: { title: 'B private' } });
    const convId = created.json.conversation.id;

    const read = await g.api('GET', `/api/v1/conversations/${convId}`, { token: tokenA });
    assert.equal(read.status, 404, 'A must not read B conversation');

    const rename = await g.api('PATCH', `/api/v1/conversations/${convId}`, { token: tokenA, body: { title: 'pwned' } });
    assert.equal(rename.status, 404, 'A must not rename B conversation');

    const del = await g.api('DELETE', `/api/v1/conversations/${convId}`, { token: tokenA });
    assert.equal(del.status, 404, 'A must not delete B conversation');

    const msgs = await g.api('GET', `/api/v1/conversations/${convId}/messages`, { token: tokenA });
    assert.equal(msgs.status, 404, 'A must not read B messages');

    const inject = await g.api('POST', `/api/v1/conversations/${convId}/messages`, {
      token: tokenA, body: { role: 'user', content: 'injected' },
    });
    assert.equal(inject.status, 404, 'A must not write into B conversation');

    // B still sees an untouched conversation
    const stillThere = await g.api('GET', `/api/v1/conversations/${convId}`, { token: tokenB });
    assert.equal(stillThere.status, 200);
    assert.equal(stillThere.json.conversation.title, 'B private');
  } finally { g.stop(); }
});

test('critical: provider credentials are invisible to another account', async () => {
  const g = await boot();
  const secretA = 'sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const secretB = 'sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  try {
    await g.api('PUT', '/api/v1/provider/credentials/openrouter', { token: tokenA, body: { api_key: secretA } });
    await g.api('PUT', '/api/v1/provider/credentials/openrouter', { token: tokenB, body: { api_key: secretB } });

    const listA = await g.api('GET', '/api/v1/provider/credentials', { token: tokenA });
    assert.equal(listA.json.credentials.length, 1);
    assert.equal(listA.json.credentials[0].masked, `…${secretA.slice(-4)}`);
    assert.ok(!listA.text.includes(secretA), 'A raw key must never be returned');
    assert.ok(!/secret_ciphertext|api_key/.test(listA.text), 'ciphertext must not be exposed either');

    const listB = await g.api('GET', '/api/v1/provider/credentials', { token: tokenB });
    assert.equal(listB.json.credentials.length, 1);
    assert.equal(listB.json.credentials[0].masked, `…${secretB.slice(-4)}`);
    assert.ok(!listB.text.includes(secretA), 'B must not see A key, even masked');

    // test with an explicit key: the response says ok/failed, never echoes it
    const testRes = await g.api('POST', '/api/v1/provider/credentials/openrouter/test', {
      token: tokenA, body: { api_key: secretA },
    });
    assert.equal(testRes.status, 200);
    assert.ok(!testRes.text.includes(secretA), 'the test endpoint must not echo the key');
    assert.ok(['connected', 'invalid'].includes(testRes.json.status));

    // A deleting its own credential leaves B's untouched
    await g.api('DELETE', '/api/v1/provider/credentials/openrouter', { token: tokenA });
    const afterB = await g.api('GET', '/api/v1/provider/credentials', { token: tokenB });
    assert.equal(afterB.json.credentials.length, 1, 'deleting A credential must not touch B');
  } finally { g.stop(); }
});

test('memories, tasks, usage and settings are per-account', async () => {
  const g = await boot();
  try {
    const memA = await g.api('POST', '/api/v1/memories', { token: tokenA, body: { content: 'A private memory' } });
    assert.equal(memA.status, 201);
    const memId = memA.json.memory.id;

    const listB = await g.api('GET', '/api/v1/memories', { token: tokenB });
    assert.equal(listB.json.rows.length, 0);
    const patchB = await g.api('PATCH', `/api/v1/memories/${memId}`, { token: tokenB, body: { content: 'pwned' } });
    assert.equal(patchB.status, 404);
    const delB = await g.api('DELETE', `/api/v1/memories/${memId}`, { token: tokenB });
    assert.equal(delB.status, 404);

    const taskA = await g.api('POST', '/api/v1/tasks', { token: tokenA, body: { type: 'research', objective: 'A task' } });
    const taskId = taskA.json.task.id;
    const taskB = await g.api('GET', `/api/v1/tasks/${taskId}`, { token: tokenB });
    assert.equal(taskB.status, 404);
    const listTasksB = await g.api('GET', '/api/v1/tasks', { token: tokenB });
    assert.equal(listTasksB.json.rows.length, 0);

    await g.api('POST', '/api/v1/usage', { token: tokenA, body: { provider: 'openrouter', model: 'x:free', latency_ms: 12 } });
    const usageB = await g.api('GET', '/api/v1/usage', { token: tokenB });
    assert.equal(usageB.json.rows.length, 0, 'usage must not leak across accounts');

    await g.api('PUT', '/api/v1/provider/settings', { token: tokenA, body: { default_model: 'only-for-a' } });
    const settingsB = await g.api('GET', '/api/v1/provider/settings', { token: tokenB });
    assert.equal(settingsB.json.settings, null);
  } finally { g.stop(); }
});

test('attachments: paths are namespaced and signing requires ownership', async () => {
  const g = await boot();
  try {
    const conv = await g.api('POST', '/api/v1/conversations', { token: tokenA, body: { title: 'files' } });
    const att = await g.api('POST', '/api/v1/attachments', {
      token: tokenA,
      body: { conversation_id: conv.json.conversation.id, filename: 'notes.txt', mime_type: 'text/plain', size_bytes: 12 },
    });
    assert.equal(att.status, 201);
    assert.match(att.json.attachment.storage_path, new RegExp(`^attachments/${USER_A}/`),
      'the object path must be namespaced under the owning user');

    // The upload target is the key INSIDE the bucket (what the storage SDK
    // wants, and what the storage RLS policy checks), while the row keeps the
    // fully-qualified path. Handing the client the fully-qualified string
    // would make every upload land under a folder RLS forbids.
    assert.equal(att.json.upload.bucket, 'attachments');
    assert.match(att.json.upload.path, new RegExp(`^${USER_A}/`), 'upload key must start with the owner id');
    assert.ok(!att.json.upload.path.startsWith('attachments/'), 'upload key must not repeat the bucket name');
    assert.equal(att.json.upload.storage_path, att.json.attachment.storage_path);
    assert.equal(`attachments/${att.json.upload.path}`, att.json.attachment.storage_path);

    // B cannot ask for a signed URL for A's object — ownership is decided
    // before anything else happens
    const signB = await g.api('GET', `/api/v1/attachments/${att.json.attachment.id}/url`, { token: tokenB });
    assert.equal(signB.status, 404, 'signing another user attachment must fail');

    // the owner gets a truthful answer: this driver has no object storage
    const signA = await g.api('GET', `/api/v1/attachments/${att.json.attachment.id}/url`, { token: tokenA });
    assert.equal(signA.status, 501);
    assert.equal(signA.json.code, 'storage_unavailable');

    // B cannot attach into A's conversation
    const attB = await g.api('POST', '/api/v1/attachments', {
      token: tokenB,
      body: { conversation_id: conv.json.conversation.id, filename: 'theirs.txt' },
    });
    assert.equal(attB.status, 404, 'a conversation you do not own cannot receive attachments');
  } finally { g.stop(); }
});

// ═══════════════════════ persistence + lifecycle ══════════════════════

test('onboarding, provider and model preferences persist across sessions', async () => {
  const g = await boot();
  try {
    await g.api('PATCH', '/api/v1/me', {
      token: tokenA,
      body: { onboarding_completed: true, preferred_provider: 'openrouter', preferred_model: 'fast:free', theme: 'obsidian' },
    });
    // a brand-new token = a fresh login for the same account
    const freshToken = await mint(USER_A, { expiresIn: '10m' });
    const me = await g.api('GET', '/api/v1/me', { token: freshToken });
    assert.equal(me.json.profile.onboarding_completed, true, 'onboarding must survive a new session');
    assert.equal(me.json.profile.preferred_model, 'fast:free');
    assert.equal(me.json.profile.preferred_provider, 'openrouter');

    // and it is not shared with the other account
    const meB = await g.api('GET', '/api/v1/me', { token: tokenB });
    assert.equal(meB.json.profile.onboarding_completed, false);
  } finally { g.stop(); }
});

test('messages persist, and an interrupted stream is marked cancelled, not left open', async () => {
  const g = await boot();
  try {
    const conv = await g.api('POST', '/api/v1/conversations', { token: tokenA, body: { title: 'chat' } });
    const id = conv.json.conversation.id;

    await g.api('POST', `/api/v1/conversations/${id}/messages`, { token: tokenA, body: { role: 'user', content: 'hello' } });
    const asst = await g.api('POST', `/api/v1/conversations/${id}/messages`, {
      token: tokenA, body: { role: 'assistant', content: 'partial', status: 'streaming', provider: 'openrouter', model: 'x:free' },
    });
    assert.equal(asst.json.message.status, 'streaming');

    const listed = await g.api('GET', `/api/v1/conversations/${id}/messages`, { token: tokenA });
    assert.equal(listed.json.rows.length, 2, 'both turns persisted');

    const retried = await g.api('PATCH', `/api/v1/messages/${asst.json.message.id}`, {
      token: tokenA,
      body: { content: 'fallback answer', model: 'fallback-model', provider: null, status: 'streaming' },
    });
    assert.equal(retried.json.message.content, 'fallback answer');
    assert.equal(retried.json.message.model, 'fallback-model', 'retry model replaces the first attempt metadata');
    assert.equal(retried.json.message.provider, null, 'stale provider metadata can be cleared while the retry resolves');

    const recovered = await g.api('POST', `/api/v1/conversations/${id}/messages/recover`, { token: tokenA });
    assert.equal(recovered.json.recovered, 1, 'the in-flight message must be recovered');

    const after = await g.api('GET', `/api/v1/conversations/${id}/messages`, { token: tokenA });
    const last = after.json.rows[after.json.rows.length - 1];
    assert.equal(last.status, 'cancelled', 'an interrupted generation is recorded as cancelled');
    assert.equal(last.error_code, 'interrupted');
  } finally { g.stop(); }
});

test('conversation list uses stable cursor pagination', async () => {
  const g = await boot();
  try {
    for (let i = 1; i <= 5; i += 1) {
      await g.api('POST', '/api/v1/conversations', { token: tokenA, body: { title: `thread ${i}` } });
    }
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 5; page += 1) {
      const url = `/api/v1/conversations?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await g.api('GET', url, { token: tokenA });
      seen.push(...res.json.rows.map((r) => r.id));
      cursor = res.json.next_cursor;
      if (!cursor) break;
    }
    assert.equal(seen.length, 5, 'every conversation appears exactly once across pages');
    assert.equal(new Set(seen).size, 5, 'no duplicates across pages');

    const badCursor = await g.api('GET', '/api/v1/conversations?cursor=@@not-a-cursor@@', { token: tokenA });
    assert.equal(badCursor.status, 200, 'a malformed cursor degrades to the first page, never a crash');
  } finally { g.stop(); }
});

test('account deletion removes that account data and nothing else', async () => {
  const g = await boot();
  try {
    await g.api('POST', '/api/v1/conversations', { token: tokenA, body: { title: 'A thread' } });
    await g.api('POST', '/api/v1/memories', { token: tokenA, body: { content: 'A memory' } });
    await g.api('PUT', '/api/v1/provider/credentials/openrouter', { token: tokenA, body: { api_key: 'sk-or-v1-cccccccccccccccccccccccccccccccccccc' } });
    const convB = await g.api('POST', '/api/v1/conversations', { token: tokenB, body: { title: 'B thread' } });

    const noConfirm = await g.api('DELETE', '/api/v1/me', { token: tokenA, body: {} });
    assert.equal(noConfirm.status, 400, 'deletion requires an explicit confirmation');

    const del = await g.api('DELETE', '/api/v1/me', { token: tokenA, body: { confirm: 'DELETE' } });
    assert.equal(del.status, 200);
    assert.equal(del.json.deleted, true);

    const afterA = await g.api('GET', '/api/v1/conversations', { token: tokenA });
    assert.equal(afterA.json.rows.length, 0, 'A data is gone');
    const credsA = await g.api('GET', '/api/v1/provider/credentials', { token: tokenA });
    assert.equal(credsA.json.credentials.length, 0, 'A credentials are gone');

    const afterB = await g.api('GET', '/api/v1/conversations', { token: tokenB });
    assert.equal(afterB.json.rows.length, 1, 'B data is untouched');
    assert.equal(afterB.json.rows[0].id, convB.json.conversation.id);
  } finally { g.stop(); }
});

// ═══════════════════════ secrets at rest ══════════════════════════════

test('stored credentials are encrypted at rest with a versioned envelope', async () => {
  const g = await boot();
  const secret = 'sk-or-v1-9f8e7d6c5b4a39281706f5e4d3c2b1a09988776655443322';
  try {
    await g.api('PUT', '/api/v1/provider/credentials/openrouter', { token: tokenA, body: { api_key: secret } });
    // wait for the local driver's debounced flush
    await new Promise((r) => setTimeout(r, 250));
    const store = g.readStore();
    assert.ok(store.includes('v1:'), 'ciphertext envelope must be stored');
    assert.ok(!store.includes(secret), 'the plaintext key must never be written to disk');
    assert.ok(!store.includes(secret.slice(-16)), 'no fragment of the key may be stored');

    const listed = await g.api('GET', '/api/v1/provider/credentials', { token: tokenA });
    assert.equal(listed.json.credentials[0].key_version, 'k1');
  } finally { g.stop(); }
});

test('the gateway refuses to store a provider key when encryption is unconfigured', async () => {
  const g = await boot({ noEncryption: true });
  try {
    const res = await g.api('PUT', '/api/v1/provider/credentials/openrouter', {
      token: tokenA, body: { api_key: 'sk-or-v1-dddddddddddddddddddddddddddddddddddd' },
    });
    assert.equal(res.status, 503, 'no plaintext fallback: it must refuse');
    assert.equal(res.json.code, 'encryption_unconfigured');
  } finally { g.stop(); }
});

test('health reports data, auth, storage and encryption honestly', async () => {
  const g = await boot();
  try {
    const h = await (await fetch(`http://127.0.0.1:${g.port}/api/health`)).json();
    assert.equal(h.data.driver, 'local');
    assert.equal(h.data.supabase_configured, false, 'no Supabase env → not claimed as configured');
    assert.equal(h.database, true, 'the local driver is reachable and is reported as such');
    assert.equal(h.auth.configured, true, 'a public key is configured');
    assert.equal(h.auth.mode, 'public-key');
    assert.equal(h.encryption.configured, true);
    assert.equal(h.storage.driver, 'local');
    assert.equal(h.ok, true);
  } finally { g.stop(); }
});

test('health never reports ONLINE when the identity provider is unconfigured', async () => {
  const g = await boot({ env: { SUPABASE_JWT_PUBLIC_KEY: '' }, noEncryption: true });
  try {
    const h = await (await fetch(`http://127.0.0.1:${g.port}/api/health`)).json();
    assert.equal(h.auth.configured, false);
    assert.equal(h.auth.mode, 'unconfigured');

    // and protected routes say so instead of limping on
    const res = await g.api('GET', '/api/v1/me', { token: tokenA });
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'auth_unconfigured');
  } finally { g.stop(); }
});

// ═══════════════════════ rate limits are per account ═══════════════════

test('a burst from one account is throttled without touching another account', async () => {
  const g = await boot();
  try {
    let throttled = null;
    // the provider-write bucket is 20/min; the limiter runs before the
    // handler, so a rejected payload still spends the budget
    for (let i = 0; i < 25 && !throttled; i += 1) {
      const r = await g.api('PUT', '/api/v1/provider/credentials/openrouter', {
        token: tokenA, body: { api_key: 'short' },
      });
      if (r.status === 429) throttled = r;
    }
    assert.ok(throttled, 'user A should eventually be throttled');
    assert.equal(throttled.json.code, 'rate_limited');
    assert.ok(Number(throttled.json.retry_after) > 0);

    // the same burst must not have spent user B's budget
    const other = await g.api('PUT', '/api/v1/provider/credentials/openrouter', {
      token: tokenB, body: { api_key: 'short' },
    });
    assert.notEqual(other.status, 429, "user B inherits user A's throttling");
    assert.equal(other.status, 400);

    // and an unauthenticated caller gets no bucket at all — just a 401
    const anon = await g.api('PUT', '/api/v1/provider/credentials/openrouter', { body: { api_key: 'short' } });
    assert.equal(anon.status, 401);
  } finally { g.stop(); }
});
