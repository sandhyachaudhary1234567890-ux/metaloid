// Production smoke test, run against the deployed entry point.
//
// `api/[...path].js` is what Vercel invokes in production. This file loads that
// module *by its default export, as a handler* — not through the gateway's own
// server — with VERCEL=1 and a read-only-style data directory, and then drives
// the whole stack through real HTTP requests against a real socket.
//
// It exists because "the build succeeded" says nothing about whether a
// deployment answers. Everything here is measured: health is probed, a session
// crosses the auth boundary, rows are written and read back, and a chat turn
// streams from a provider. If the serverless entry cannot boot, or boots into
// something different from the gateway that runs locally, this fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SignJWT, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const ENTRY = path.join(ROOT, 'api', '[...path].js');

const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const PUBLIC_PEM = await exportSPKI(publicKey);
const PRIVATE_PEM = await exportPKCS8(privateKey);
const ENC_KEY = crypto.randomBytes(32).toString('base64');

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

const pemToBuffer = (pem) => Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

async function mint(sub) {
  const key = await crypto.subtle.importKey('pkcs8', pemToBuffer(PRIVATE_PEM), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return new SignJWT({ role: 'authenticated', email: `${sub.slice(0, 4)}@example.test` })
    .setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setAudience('authenticated')
    .setIssuedAt().setExpirationTime('1h').sign(key);
}

const tokenA = await mint(USER_A);
const tokenB = await mint(USER_B);

function port() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

// The platform's own environment, reproduced. VERCEL=1 is what the entry
// reads to know it must not open a listening socket of its own; the data
// directory stands in for the read-only bundle plus /tmp.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-deploy-'));
// Reproduce the platform's environment, not the developer's. Without this the
// entry reads server/.env as well, and a real Supabase project in there would
// change what is being tested — a live JWKS URL once sent this file to a
// blocked host mid-suite.
process.env.METALOID_NO_DOTENV = '1';
process.env.VERCEL = '1';
process.env.METALOID_DATA_DIR = dataDir;
process.env.SUPABASE_JWT_PUBLIC_KEY = PUBLIC_PEM;
process.env.SUPABASE_JWT_ALG = 'ES256';
process.env.METALOID_ENCRYPTION_KEYS = `k1:${ENC_KEY}`;
process.env.METALOID_ENCRYPTION_ACTIVE = 'k1';
delete process.env.PORT;
delete process.env.BIND_HOST;

const providerPort = await port();
const provider = spawn(process.execPath,
  [path.join(HERE, 'fake-provider.mjs'), '--port', String(providerPort), '--scenario', 'ok'],
  { stdio: 'ignore' });
process.env.OPENROUTER_BASE = `http://127.0.0.1:${providerPort}/api/v1`;
process.env.OPENROUTER_API_KEY = 'platform-key-for-smoke-test';
process.env.NVIDIA_ENABLED = 'false';
process.env.NVIDIA_API_KEY = '';

// Load the production entry exactly as the platform does.
const entry = await import(pathToFileURL(ENTRY).href);
assert.equal(typeof entry.default, 'function', 'api/[...path].js must default-export a handler');
assert.ok(entry.config && entry.config.maxDuration > 0, 'streaming needs a maxDuration');

const server = http.createServer((req, res) => {
  Promise.resolve(entry.default(req, res)).catch((e) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e && e.message) }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const api = async (method, path_, { token, body } = {}) => {
  const r = await fetch(`${base}${path_}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: r.status, json };
};

const chat = async (message, { token } = {}) => {
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ message }),
  });
  const text = await r.text();
  const events = text.split('\n').filter((l) => l.startsWith('data:'))
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } }).filter(Boolean);
  return { status: r.status, text: events.filter((e) => typeof e.token === 'string').map((e) => e.token).join(''), events, raw: text };
};

test.after(() => {
  // SSE keeps a socket open; close() alone would wait for it and stall the run.
  server.closeAllConnections?.();
  server.close();
  try { provider.kill('SIGKILL'); } catch { /* gone */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* gone */ }
});

// ═══════════════════════════════════════════════════════════════════════
test('the deployed entry serves real health, not a hardcoded ok', async () => {
  const h = await api('GET', '/api/health');
  assert.equal(h.status, 200, JSON.stringify(h.json).slice(0, 300));
  assert.equal(h.json.server, true, 'the process is answering');
  assert.equal(h.json.ok, true);
  // `ai` is measured through the provider catalogue, so with a fake provider
  // answering it must be true — and the shape the client reads must be there.
  assert.equal(typeof h.json.ai, 'boolean');
  assert.equal(typeof h.json.database, 'boolean');
  assert.equal(h.json.database, true, 'the data driver is reachable');
  assert.equal(h.json.voice, false, 'speech runs in the browser and is reported honestly');
  assert.ok(h.json.auth && typeof h.json.auth.configured === 'boolean', 'auth state is reported');
  assert.ok(h.json.storage, 'storage state is reported');
  assert.equal(h.json.data.driver, 'local', 'no SUPABASE_DB here, so the local driver is named');
  assert.equal(h.json.encryption.configured, true);
});

test('the auth boundary holds on the deployed entry', async () => {
  assert.equal((await api('GET', '/api/v1/me')).status, 401, 'no token reaches no data');
  assert.equal((await api('GET', '/api/v1/conversations')).status, 401);
  assert.equal((await api('GET', '/api/v1/me', { token: 'not-a-jwt' })).status, 401);
  assert.equal((await api('POST', '/api/chat', { body: { message: 'hi' } })).status, 401, 'chat is not an open proxy');
});

test('the account contract round-trips through the deployed entry', async () => {
  const me = await api('GET', '/api/v1/me', { token: tokenA });
  assert.equal(me.status, 200, JSON.stringify(me.json).slice(0, 300));
  assert.equal(me.json.profile.id, USER_A, 'identity comes from the session');

  const conv = await api('POST', '/api/v1/conversations', { token: tokenA, body: { title: 'Deployed' } });
  assert.equal(conv.status, 201);
  const cid = conv.json.conversation.id;

  const msg = await api('POST', `/api/v1/conversations/${cid}/messages`, {
    token: tokenA, body: { role: 'user', content: 'persisted?' },
  });
  assert.equal(msg.status, 201);

  // Read it back on a fresh request: persistence, not an in-handler echo.
  const listed = await api('GET', `/api/v1/conversations/${cid}/messages`, { token: tokenA });
  assert.equal(listed.json.rows.length, 1);
  assert.equal(listed.json.rows[0].content, 'persisted?');

  // Cross-account: B must not see A's thread.
  assert.equal((await api('GET', `/api/v1/conversations/${cid}`, { token: tokenB })).status, 404);
  assert.equal((await api('GET', '/api/v1/conversations', { token: tokenB })).json.rows.length, 0);
});

test('a saved model drives a streamed reply on the deployed entry', async () => {
  const cred = await api('PUT', '/api/v1/provider/credentials/openrouter', {
    token: tokenA, body: { api_key: 'sk-or-v1-deploymenttestkey0000000000000000000' },
  });
  assert.equal(cred.status, 201, JSON.stringify(cred.json));
  assert.ok(!JSON.stringify(cred.json).includes('deploymenttestkey'), 'the key never comes back');

  const saved = await api('PUT', '/api/v1/provider/settings', {
    token: tokenA, body: { default_provider: 'openrouter', default_model: 'fake/beta:free', free_only: true },
  });
  assert.equal(saved.status, 200);

  const reread = await api('GET', '/api/v1/provider/settings', { token: tokenA });
  assert.equal(reread.json.settings.default_model, 'fake/beta:free', 'the choice survived a new request');

  const turn = await chat('deployed smoke', { token: tokenA });
  assert.equal(turn.status, 200, turn.raw.slice(0, 300));
  assert.ok(turn.text.includes('fake/beta:free'), `expected the saved model to be used, got "${turn.text}"`);

  const catalogue = await api('GET', '/api/models');
  assert.ok(Array.isArray(catalogue.json.models) && catalogue.json.models.length > 0, 'the model list is served');
});

test('a wrong route is a clean 404, and unknown api paths are not SPA html', async () => {
  const nope = await api('GET', '/api/v1/does-not-exist', { token: tokenA });
  assert.equal(nope.status, 404);
  assert.equal(nope.json.code, 'not_found');
  const raw = await fetch(`${base}/api/totally-unknown`);
  assert.equal(raw.status, 404);
  const body = await raw.text();
  assert.ok(!/<!doctype html/i.test(body), 'an API miss must not return the app shell');
});
