// Gateway contract tests — run with `npm test` (node:test, no network, no key).
//
// These lock the behaviour that matters in production:
//   * a dead free model fails over instead of surfacing a raw provider error
//   * a bad key fails FAST (no pointless candidate walk)
//   * the client never receives provider JSON, only a stable code + sentence
//   * health never claims `ai: true` when it cannot answer
//
// Each test boots its own gateway process against a fake provider, on its own
// port, so the suite is parallel-safe and leaves no state behind.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/**
 * Ask the OS for a free port instead of guessing one. A fixed range collides
 * with whatever else is running (the showcase, another agent, a second test
 * run) and makes failures look like product bugs.
 */
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

function waitFor(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve(true);
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${url}`));
      setTimeout(tick, 120);
    };
    tick();
  });
}

/** Boot a fake provider + a gateway wired to it. */
async function boot({ scenario = 'ok', failFirst = 1, key = 'test-key-0123456789', extraEnv = {} }) {
  const providerPort = await port();
  const gatewayPort = await port();

  const provider = spawn(process.execPath, [
    path.join(HERE, 'fake-provider.mjs'),
    '--port', String(providerPort), '--scenario', scenario, '--fail-first', String(failFirst),
  ], { stdio: 'ignore' });

  const gateway = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      METALOID_NO_DOTENV: '1',
      PORT: String(gatewayPort),
      BIND_HOST: '127.0.0.1',
      OPENROUTER_BASE: `http://127.0.0.1:${providerPort}/api/v1`,
      OPENROUTER_API_KEY: key,
      NVIDIA_ENABLED: 'false',
      NVIDIA_API_KEY: '',
      ...extraEnv,
    },
  });
  const logs = [];
  gateway.stdout.on('data', (d) => logs.push(String(d)));
  gateway.stderr.on('data', (d) => logs.push(String(d)));

  await waitFor(`http://127.0.0.1:${gatewayPort}/api/health`);
  return {
    gatewayPort,
    providerPort,
    logs,
    gateway,
    provider,
    stop() {
      try { gateway.kill('SIGKILL'); } catch { /* gone */ }
      try { provider.kill('SIGKILL'); } catch { /* gone */ }
    },
  };
}

/** Read a full SSE response and return the parsed events. */
async function chat(port, message = 'hello', extra = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...extra }),
  });
  const text = await res.text();
  const events = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    .filter(Boolean);
  return { status: res.status, events, raw: text };
}

// ---------------------------------------------------------------------------

test('dead model fails over: user gets the answer, never the 400', async () => {
  const g = await boot({ scenario: 'failover', failFirst: 1 });
  try {
    const { events, status } = await chat(g.gatewayPort, 'explain agents');
    assert.equal(status, 200);
    const final = events.filter((e) => e.token).pop();
    assert.ok(final, 'expected streamed tokens');
    assert.match(final.token, /Answer from fake\//);
    assert.ok(events.some((e) => e.retry), 'expected a retry event for the rejected model');
    assert.ok(!events.some((e) => e.error), 'no error event when failover succeeds');
    const joined = JSON.stringify(events);
    assert.ok(!/invalid parameters/i.test(joined), 'provider text must not leak to the client');
    assert.ok(events.some((e) => e.done), 'stream must end with done');
  } finally { g.stop(); }
});

test('quarantine: a rejected slug is not tried again on the next turn', async () => {
  const g = await boot({ scenario: 'failover', failFirst: 1 });
  try {
    await chat(g.gatewayPort, 'first');
    const before = await (await fetch(`http://127.0.0.1:${g.providerPort}/__calls`)).json();
    const chatCallsBefore = before.filter((c) => c.path.endsWith('/chat/completions')).length;

    await chat(g.gatewayPort, 'second');
    const after = await (await fetch(`http://127.0.0.1:${g.providerPort}/__calls`)).json();
    const chatCallsAfter = after.filter((c) => c.path.endsWith('/chat/completions')).length;

    // first turn: 2 calls (rejected + good). second turn: 1 call (good only).
    assert.equal(chatCallsBefore, 2, `expected 2 calls on turn 1, saw ${chatCallsBefore}`);
    assert.equal(chatCallsAfter - chatCallsBefore, 1, 'dead slug must be skipped on later turns');
  } finally { g.stop(); }
});

test('every model dead: honest sentence + stable code, no provider JSON', async () => {
  const g = await boot({ scenario: 'failover', failFirst: 99 });
  try {
    const { events, status } = await chat(g.gatewayPort, 'anything');
    assert.equal(status, 200, 'stream already started, so errors ride the stream');
    const err = events.find((e) => e.error);
    assert.ok(err, 'expected an error event');
    assert.equal(err.code, 'no_model');
    assert.match(err.error, /free model/i);
    assert.ok(!/invalid parameters|openrouter 400/i.test(err.error), 'raw provider text must not leak');
  } finally { g.stop(); }
});

test('bad key: fails fast with bad_key and does not walk candidates', async () => {
  const g = await boot({ scenario: 'auth' });
  try {
    const { events } = await chat(g.gatewayPort, 'hello');
    const err = events.find((e) => e.error);
    assert.ok(err, 'expected an error event');
    assert.equal(err.code, 'bad_key');
    assert.match(err.error, /API key/i);
    const calls = await (await fetch(`http://127.0.0.1:${g.providerPort}/__calls`)).json();
    const chatCalls = calls.filter((c) => c.path.endsWith('/chat/completions')).length;
    assert.equal(chatCalls, 1, 'a 401 must not be retried across models');
  } finally { g.stop(); }
});

test('rate limits across all candidates: rate_limited, not a crash', async () => {
  const g = await boot({ scenario: 'ratelimit' });
  try {
    const { events } = await chat(g.gatewayPort, 'hello');
    const err = events.find((e) => e.error);
    assert.ok(err);
    assert.equal(err.code, 'rate_limited');
  } finally { g.stop(); }
});

test('silent empty stream is treated as a dead candidate', async () => {
  const g = await boot({ scenario: 'empty' });
  try {
    const { events } = await chat(g.gatewayPort, 'hello');
    assert.ok(events.some((e) => e.error), 'an empty stream must not look like success');
  } finally { g.stop(); }
});

test('a saved key the server cannot decrypt: health says so, chat names the fix', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-unreadable-'));

  // Phase 1 — store a key with a stable server key, like a normal setup.
  let credentialId = '';
  const first = await boot({ key: '', scenario: 'ok', extraEnv: { METALOID_DATA_DIR: dir, METALOID_CREDENTIAL_KEY: 'first-key-0123456789' } });
  try {
    const created = await (await fetch(`http://127.0.0.1:${first.gatewayPort}/api/providers/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'openrouter', credential: 'sk-or-v1-unreadable-0123456789abcdef' }),
    })).json();
    credentialId = created.id;
    assert.ok(credentialId, 'credential must be stored');
    assert.equal(created.credential_key, 'stable', 'the server must report a stable encryption key');
    const health = await (await fetch(`http://127.0.0.1:${first.gatewayPort}/api/health`)).json();
    assert.equal(health.byok, true, 'a readable stored key is a live path');
  } finally { first.stop(); }

  // Phase 2 — the row survives, but the server can no longer open it (key
  // rotation, redeploy, or a process that booted with an ephemeral key).
  const file = path.join(dir, 'credentials.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(stored.userCredentials.length, 1);
  assert.equal(stored.userCredentials[0].id, credentialId);
  stored.userCredentials[0].encryptedData = 'not-a-valid-envelope';
  fs.writeFileSync(file, JSON.stringify(stored));

  const second = await boot({ key: '', scenario: 'ok', extraEnv: { METALOID_DATA_DIR: dir, METALOID_CREDENTIAL_KEY: 'second-key-0123456789' } });
  try {
    // Health must not call this connected: "Connected" while every message
    // fails is the exact lie this covers.
    const health = await (await fetch(`http://127.0.0.1:${second.gatewayPort}/api/health`)).json();
    assert.equal(health.byok, false, 'an unreadable key is not a working connection');
    assert.deepEqual(health.byokUnreadable, ['openrouter']);
    assert.equal(health.byokError, 'credential_unreadable');

    // And the chat must say what to do — not "the model provider failed".
    const { status, events } = await chat(second.gatewayPort, 'hi');
    assert.equal(status, 200, 'stream already started so errors ride the stream');
    const err = events.find((e) => e.error);
    assert.ok(err, 'expected an error event');
    assert.equal(err.code, 'credential_unreadable');
    assert.match(err.error, /replace it/i);
    assert.ok(!events.some((e) => e.token), 'a broken key must never produce a fabricated answer');
  } finally { second.stop(); }
});

test('a malformed encryption keyring cannot take health down', async () => {
  // A deployment with a broken keyring must still answer /api/health with an
  // explanation — an unresolved health route is indistinguishable from a dead
  // gateway, which is the worst possible way to learn about a bad env var.
  const g = await boot({ key: '', scenario: 'ok', extraEnv: { METALOID_ENCRYPTION_KEYS: 'k1:tooshort' } });
  try {
    const res = await fetch(`http://127.0.0.1:${g.gatewayPort}/api/health`);
    assert.equal(res.status, 200);
    const health = await res.json();
    assert.equal(health.ok, true);
    assert.equal(health.encryption.configured, false);
    assert.match(String(health.encryption.error), /32 bytes/);
  } finally { g.stop(); }
});

test('no key configured: streams a no_provider error naming the fix, never a silent demo', async () => {
  const g = await boot({ key: '', scenario: 'ok' });
  try {
    // The route deliberately does NOT reject before trying BYOK: a connected
    // user key is a complete path, so the request streams and the failure is
    // reported as a stable code + sentence. (A hard 503 here is what made a
    // BYOK-only deployment look unconfigured.)
    const { status, events } = await chat(g.gatewayPort, 'hello');
    assert.equal(status, 200);
    const err = events.find((e) => e.error);
    assert.ok(err, 'expected an error event');
    assert.equal(err.code, 'no_provider');
    assert.match(err.error, /provider key/i);
    assert.ok(!events.some((e) => e.token), 'must not fabricate an answer');
  } finally { g.stop(); }
});

test('health is honest: ai:true only when the provider answers', async () => {
  const good = await boot({ scenario: 'ok' });
  try {
    const h = await (await fetch(`http://127.0.0.1:${good.gatewayPort}/api/health`)).json();
    assert.equal(h.ai, true);
    // wired to the fake provider, so it must self-identify as a mock — a demo
    // that pretends to be a live model is the failure mode we refuse
    assert.equal(h.provider, 'local-mock');
    assert.equal(h.models.catalogue, true);
    assert.ok(h.models.free > 0);
  } finally { good.stop(); }

  const bad = await boot({ scenario: 'ok', key: '' });
  try {
    const h = await (await fetch(`http://127.0.0.1:${bad.gatewayPort}/api/health`)).json();
    assert.equal(h.ai, false, 'no key must never report ai:true');
    assert.equal(h.provider, null);
  } finally { bad.stop(); }
});

test('unreachable provider: ai:false + degraded, chat still answers honestly', async () => {
  const g = await boot({ scenario: 'network' });
  try {
    const h = await (await fetch(`http://127.0.0.1:${g.gatewayPort}/api/health`)).json();
    assert.equal(h.ai, false);
    assert.equal(h.degraded, true);
    assert.equal(h.models.catalogue, false);
    const { events } = await chat(g.gatewayPort, 'hello');
    assert.ok(events.some((e) => e.error), 'must not pretend to succeed');
  } finally { g.stop(); }
});

test('models endpoint flags quarantined slugs instead of hiding them', async () => {
  const g = await boot({ scenario: 'failover', failFirst: 1 });
  try {
    await chat(g.gatewayPort, 'warm up failover');
    const { models } = await (await fetch(`http://127.0.0.1:${g.gatewayPort}/api/models`)).json();
    assert.ok(models.length >= 3);
    assert.ok(models.some((m) => m.unavailable === true), 'the rejected slug must be flagged');
    assert.ok(models.some((m) => m.unavailable === false), 'healthy slugs must remain available');
  } finally { g.stop(); }
});

test('input validation: empty and oversized messages are rejected', async () => {
  const g = await boot({ scenario: 'ok' });
  try {
    const empty = await fetch(`http://127.0.0.1:${g.gatewayPort}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '   ' }),
    });
    assert.equal(empty.status, 400);
    const big = await fetch(`http://127.0.0.1:${g.gatewayPort}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(9000) }),
    });
    assert.equal(big.status, 400);
  } finally { g.stop(); }
});

test('CORS: only allow-listed origins are echoed back', async () => {
  const g = await boot({ scenario: 'ok', extraEnv: { ALLOW_ORIGINS: 'https://metaloid.vercel.app' } });
  try {
    const allowed = await fetch(`http://127.0.0.1:${g.gatewayPort}/api/health`, {
      headers: { Origin: 'https://metaloid.vercel.app' },
    });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://metaloid.vercel.app');
    const denied = await fetch(`http://127.0.0.1:${g.gatewayPort}/api/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(denied.headers.get('access-control-allow-origin'), null, 'unknown origins must not be echoed');
  } finally { g.stop(); }
});

test('SIGTERM: the gateway drains and exits cleanly (no uncaughtException)', async () => {
  const g = await boot({ scenario: 'ok' });
  try {
    const exited = new Promise((resolve) => g.gateway.once('exit', (code, signal) => resolve({ code, signal })));
    g.gateway.kill('SIGTERM');
    const result = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve({ code: 'timeout', signal: null }), 6000)),
    ]);
    assert.deepEqual(result, { code: 0, signal: null }, 'SIGTERM must exit 0 promptly');
    const output = g.logs.join('');
    assert.ok(output.includes('draining connections'), 'shutdown should announce itself');
    assert.ok(!output.includes('uncaughtException'), `shutdown must not throw: ${output.slice(-400)}`);
  } finally {
    g.stop();
    try { g.provider.kill('SIGKILL'); } catch { /* gone */ }
  }
});
