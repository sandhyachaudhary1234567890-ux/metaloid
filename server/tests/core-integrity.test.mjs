// Core integrity: a change in the UI must propagate through the whole stack.
//
// This is the test the spec asks for by name. It boots a real gateway against
// a real (fake) provider, saves a model choice through the API-v1 contract
// exactly as the Settings screen does, and then asserts that the *outbound
// provider request used that model*. The fake streams back the model id it
// received, so the assertion is about what actually left the process — not
// about what a handler claimed it would do.
//
// The bug this locks down: the UI listed live free models from the runtime
// catalogue, the choice was persisted, and the router then resolved a model
// from a static registry manifest that declares OpenRouter's model list as
// empty. The user's selection could not reach the provider. These tests fail
// if that seam is ever re-broken.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SignJWT, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const PUBLIC_PEM = await exportSPKI(publicKey);
const PRIVATE_PEM = await exportPKCS8(privateKey);
const ENC_KEY = crypto.randomBytes(32).toString('base64');

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

const pemToBuffer = (pem) => Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

async function mint(sub, { expiresIn = '1h' } = {}) {
  const key = await crypto.subtle.importKey('pkcs8', pemToBuffer(PRIVATE_PEM), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return new SignJWT({ role: 'authenticated', email: `${sub.slice(0, 4)}@example.test` })
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

const tokenA = await mint(USER_A);
const tokenB = await mint(USER_B);

function port() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

async function waitFor(url, timeoutMs = 20000) {
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

/**
 * Boot a fake provider and a gateway wired to it, sharing one temp data dir
 * so the local store is a real file rather than process memory.
 */
async function boot() {
  const providerPort = await port();
  const gatewayPort = await port();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-integrity-'));

  const provider = spawn(process.execPath, [
    path.join(HERE, 'fake-provider.mjs'), '--port', String(providerPort), '--scenario', 'ok',
  ], { stdio: 'ignore' });

  const gateway = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      METALOID_NO_DOTENV: '1',
      PORT: String(gatewayPort),
      BIND_HOST: '127.0.0.1',
      METALOID_DATA_DIR: dataDir,
      OPENROUTER_BASE: `http://127.0.0.1:${providerPort}/api/v1`,
      OPENROUTER_API_KEY: 'platform-key-not-used-in-byok-tests',
      NVIDIA_ENABLED: 'false',
      NVIDIA_API_KEY: '',
      SUPABASE_JWT_PUBLIC_KEY: PUBLIC_PEM,
      SUPABASE_JWT_ALG: 'ES256',
      METALOID_ENCRYPTION_KEYS: `k1:${ENC_KEY}`,
      METALOID_ENCRYPTION_ACTIVE: 'k1',
      NVIDIA_ENABLED: 'false',
    },
  });
  const logs = [];
  gateway.stdout.on('data', (d) => logs.push(String(d)));
  gateway.stderr.on('data', (d) => logs.push(String(d)));

  await waitFor(`http://127.0.0.1:${gatewayPort}/api/health`);

  const api = async (method, path_, { token, body } = {}) => {
    const r = await fetch(`http://127.0.0.1:${gatewayPort}${path_}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: r.status, json };
  };

  /** POST /api/chat and collect the streamed text plus the reported model. */
  const chat = async (message, { token, body = {} } = {}) => {
    const r = await fetch(`http://127.0.0.1:${gatewayPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ message, ...body }),
    });
    const text = await r.text();
    const events = text.split('\n').filter((l) => l.startsWith('data:'))
      .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
      .filter(Boolean);
    const tokens = events.filter((e) => typeof e.token === 'string').map((e) => e.token);
    const models = events.filter((e) => e.meta && e.meta.model).map((e) => e.meta.model);
    return { status: r.status, events, text: tokens.join(''), models, raw: text };
  };

  return {
    gatewayPort,
    providerPort,
    dataDir,
    logs,
    api,
    chat,
    stop() {
      try { gateway.kill('SIGKILL'); } catch { /* gone */ }
      try { provider.kill('SIGKILL'); } catch { /* gone */ }
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* gone */ }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
test('the selected model actually drives the provider request', async () => {
  const g = await boot();
  try {
    // 1. The catalogue the UI reads must be real, live, free-only.
    const catalogue = await g.api('GET', '/api/models');
    assert.equal(catalogue.status, 200);
    const ids = catalogue.json.models.map((m) => m.id);
    assert.ok(ids.length >= 3, `catalogue should list the provider's models, saw ${ids.length}`);
    assert.ok(ids.every((id) => id.endsWith(':free')), 'the catalogue is free-only');
    assert.deepEqual(ids.sort(), ['fake/alpha:free', 'fake/beta:free', 'fake/gamma:free'].sort());

    // 2. Connect a provider key through the contract, as the setup screen does.
    const cred = await g.api('PUT', '/api/v1/provider/credentials/openrouter', {
      token: tokenA, body: { api_key: 'sk-or-v1-integritytestkey000000000000000000' },
    });
    assert.equal(cred.status, 201, JSON.stringify(cred.json));

    // 3. Pick a model deliberately: NOT the first one the catalogue offers.
    const chosen = 'fake/beta:free';
    const saved = await g.api('PUT', '/api/v1/provider/settings', {
      token: tokenA,
      body: { default_provider: 'openrouter', default_model: chosen, free_only: true, fallback_enabled: true },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.settings.default_model, chosen, 'the choice was persisted');

    // 4. A fresh GET must return it — persistence, not an echo.
    const reread = await g.api('GET', '/api/v1/provider/settings', { token: tokenA });
    assert.equal(reread.json.settings.default_model, chosen);

    // 5. Chat. The fake answers "Answer from <model>", so the reply is
    //    evidence of the model the provider was actually asked for.
    const turn = await g.chat('hello there', { token: tokenA });
    assert.equal(turn.status, 200, turn.raw.slice(0, 300));
    assert.ok(turn.text.length > 0, `expected streamed text, got: ${turn.raw.slice(0, 400)}`);
    assert.ok(
      turn.text.includes(chosen),
      `the provider was asked for "${chosen}" but replied "${turn.text}" — the saved model did not reach the request`
    );
    assert.ok(!turn.models.some((m) => m && m !== chosen), `attempted models were ${turn.models.join(', ')}`);
  } finally { g.stop(); }
});

test('a second account is unaffected by the first account\'s model choice', async () => {
  const g = await boot();
  try {
    await g.api('PUT', '/api/v1/provider/credentials/openrouter', {
      token: tokenA, body: { api_key: 'sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    await g.api('PUT', '/api/v1/provider/settings', {
      token: tokenA, body: { default_provider: 'openrouter', default_model: 'fake/gamma:free' },
    });

    await g.api('PUT', '/api/v1/provider/credentials/openrouter', {
      token: tokenB, body: { api_key: 'sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    });

    const a = await g.chat('which model', { token: tokenA });
    assert.ok(a.text.includes('fake/gamma:free'), `A should use its own choice, got "${a.text}"`);

    // B never picked a model, so the router falls back to the first live free
    // candidate — and must not inherit A's choice.
    const b = await g.chat('which model', { token: tokenB });
    assert.ok(b.text.includes('fake/'), `B should still be served, got "${b.text}"`);
    assert.ok(!b.text.includes('fake/gamma:free'), `B must not inherit A's saved model, got "${b.text}"`);
  } finally { g.stop(); }
});

test('a saved model that is no longer offered degrades to a live free model, never to paid', async () => {
  const g = await boot();
  try {
    await g.api('PUT', '/api/v1/provider/credentials/openrouter', {
      token: tokenA, body: { api_key: 'sk-or-v1-cccccccccccccccccccccccccccccccc' },
    });
    // A slug the provider does not serve (models churn constantly).
    await g.api('PUT', '/api/v1/provider/settings', {
      token: tokenA, body: { default_provider: 'openrouter', default_model: 'vendor/model-that-was-retired:free' },
    });

    const turn = await g.chat('still work?', { token: tokenA });
    assert.equal(turn.status, 200, turn.raw.slice(0, 300));
    assert.ok(turn.text.includes('fake/'), `expected a live free model, got "${turn.text}"`);
    assert.ok(
      !turn.text.includes('retired'),
      'the dead slug must not be sent to the provider'
    );
    // Whatever happened, it stayed inside the free catalogue.
    assert.ok(/:free$/.test(turn.text.replace(/^Answer from /, '').trim()), `reply used a non-free model: "${turn.text}"`);
  } finally { g.stop(); }
});
