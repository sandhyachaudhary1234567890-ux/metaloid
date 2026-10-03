// Regression tests for the environment-initialisation order (release blocker 2).
//
// What went wrong
// ---------------
// `server/src/auth.js` used to capture SUPABASE_JWT_SECRET / _JWKS_URL /
// _PUBLIC_KEY into module-scope constants. ES module imports are evaluated
// before the importing module's body, so the dotenv loader sitting inside
// index.js's body ran *after* auth.js had already read an empty environment.
//
// The observable damage on a correctly-configured self-hosted gateway was:
//
//   * /api/health reported `auth: { configured: false }` — the operator's real
//     secret was present and simply ignored; and
//   * because `localOpenMode()` (core/users.js) gates the development owner
//     fallback on `authConfigured()`, a loopback caller could still be handed
//     the local owner identity on a gateway that DID have a verifier.
//
// Why the existing suite missed it
// --------------------------------
// Every other test sets process.env *before* importing the entry, which is
// exactly the order that hides the bug. These tests deliberately exercise the
// order that a real `server/.env` produces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const ENV_FILE = path.join(ROOT, 'server', '.env');
const AUTH_MODULE = path.join(ROOT, 'server', 'src', 'auth.js');

const SECRET = 'regression-hs256-secret-not-a-real-key';
const VERIFIER_VARS = ['SUPABASE_JWT_SECRET', 'SUPABASE_JWKS_URL', 'SUPABASE_JWT_PUBLIC_KEY'];

/** Environment for a child: the caller's, minus any inherited verifier. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const v of VERIFIER_VARS) delete env[v];
  env.METALOID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-envorder-'));
  // The suite normally sets this; these tests are specifically about the
  // loader, so it must not be inherited.
  delete env.METALOID_NO_DOTENV;
  return env;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

/** Run a node script to completion and return { code, stdout, stderr }. */
function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Start the real gateway and poll /api/health. Returns a stop() function.
 * Booting index.js (not a stub) is the point: it is the file whose import
 * order caused the bug.
 */
async function bootGateway(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), BIND_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const stop = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`gateway exited early: ${log.slice(0, 400)}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return { port, health: await r.json(), stop, log: () => log };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  stop();
  throw new Error(`gateway never answered on ${port}: ${log.slice(0, 400)}`);
}

// ═══════════════════════════════════════════════════════════════════════
// A — the value arrives through the documented production configuration path
//     (a `server/.env` file), not through the ambient environment.

test('A: a verifier supplied only through server/.env is actually applied', async (t) => {
  // Never clobber a developer's real file; skip loudly instead of silently
  // testing nothing.
  if (fs.existsSync(ENV_FILE)) {
    t.skip(`server/.env already exists at ${ENV_FILE}; refusing to overwrite it`);
    return;
  }

  fs.writeFileSync(ENV_FILE, `SUPABASE_JWT_SECRET=${SECRET}\n`, 'utf8');
  let gw;
  try {
    gw = await bootGateway(cleanEnv());
    assert.equal(
      gw.health.auth.configured, true,
      `a .env-configured gateway must report auth configured; log: ${gw.log().slice(0, 300)}`
    );
    assert.equal(gw.health.auth.mode, 'hs256', 'HS256 secret selects the hs256 verifier');
  } finally {
    gw?.stop();
    fs.rmSync(ENV_FILE, { force: true });
  }

  // The file is gone again — prove the loader is what made the difference,
  // so this test cannot pass because of a leaked ambient value.
  assert.equal(fs.existsSync(ENV_FILE), false, 'the temporary .env must be removed');
});

// ═══════════════════════════════════════════════════════════════════════
// B — belt and braces: configuration is resolved at call time, so even a
//     module that was imported before the value existed sees it.

test('B: auth configuration is resolved at runtime, not frozen at import', async () => {
  const script = `
    process.env.METALOID_NO_DOTENV = '1';
    for (const v of ${JSON.stringify(VERIFIER_VARS)}) delete process.env[v];
    const auth = await import(${JSON.stringify(AUTH_MODULE)});
    const before = auth.authConfigured();
    // Set the verifier only now — strictly AFTER the module was evaluated.
    process.env.SUPABASE_JWT_SECRET = ${JSON.stringify(SECRET)};
    const after = auth.authConfigured();
    console.log(JSON.stringify({ before, after, mode: auth.authMode() }));
  `;
  const { code, stdout, stderr } = await runNode(['--input-type=module', '-e', script], cleanEnv());
  assert.equal(code, 0, stderr.slice(0, 400));
  const out = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(out.before, false, 'no verifier configured yet');
  assert.equal(out.after, true, 'a verifier set after import must still be honoured');
  assert.equal(out.mode, 'hs256');
});

// ═══════════════════════════════════════════════════════════════════════
// C — absent configuration fails CLOSED. No accidental anonymous identity.

test('C: with no verifier, tokens are refused rather than accepted', async () => {
  const script = `
    process.env.METALOID_NO_DOTENV = '1';
    for (const v of ${JSON.stringify(VERIFIER_VARS)}) delete process.env[v];
    const auth = await import(${JSON.stringify(AUTH_MODULE)});
    const result = { configured: auth.authConfigured(), mode: auth.authMode() };
    try {
      await auth.verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.x');
      result.threw = false;
    } catch (e) {
      result.threw = true;
      result.code = e.code;
      result.status = e.status;
    }
    console.log(JSON.stringify(result));
  `;
  const { code, stdout, stderr } = await runNode(['--input-type=module', '-e', script], cleanEnv());
  assert.equal(code, 0, stderr.slice(0, 400));
  const out = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(out.configured, false);
  assert.equal(out.mode, 'unconfigured');
  assert.equal(out.threw, true, 'an unconfigured verifier must never return an identity');
  assert.equal(out.code, 'auth_unconfigured');
  assert.equal(out.status, 503, 'unconfigured is an operator problem, not a client one');
});

// ═══════════════════════════════════════════════════════════════════════
// D — a configured .env must switch OFF the development owner fallback.
//     This is the security consequence of the original bug: before the fix
//     authConfigured() was false, so a loopback caller was handed the local
//     owner identity on a gateway that was in fact configured.

test('D: a .env-configured gateway refuses the local owner fallback', async (t) => {
  if (fs.existsSync(ENV_FILE)) {
    t.skip(`server/.env already exists at ${ENV_FILE}; refusing to overwrite it`);
    return;
  }
  fs.writeFileSync(ENV_FILE, `SUPABASE_JWT_SECRET=${SECRET}\n`, 'utf8');
  let gw;
  try {
    gw = await bootGateway(cleanEnv());
    // No VERCEL and no METALOID_MODE here on purpose: the only thing that may
    // disable the fallback is the configured verifier itself.
    for (const route of ['/api/memory', '/api/missions']) {
      const r = await fetch(`http://127.0.0.1:${gw.port}${route}`);
      assert.ok(
        r.status === 401 || r.status === 403 || r.status === 503,
        `${route} answered ${r.status} on a configured gateway — the local owner fallback leaked`
      );
    }
  } finally {
    gw?.stop();
    fs.rmSync(ENV_FILE, { force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// E — hosted protection is untouched: hosted + missing verifier still rejects.

test('E: a hosted deployment with no verifier still rejects protected routes', async () => {
  const script = `
    process.env.METALOID_NO_DOTENV = '1';
    process.env.VERCEL = '1';
    for (const v of ${JSON.stringify(VERIFIER_VARS)}) delete process.env[v];
    const http = await import('node:http');
    const path = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const entry = await import(pathToFileURL(path.join(process.cwd(), 'api', '[...path].js')).href);
    const server = http.createServer((req, res) => {
      Promise.resolve(entry.default(req, res)).catch((e) => { res.statusCode = 500; res.end(String(e && e.message)); });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const health = await fetch(base + '/api/health').then((r) => r.json());
    const codes = {};
    for (const p of ['/api/memory', '/api/missions', '/api/usage', '/api/debug/summary']) {
      codes[p] = (await fetch(base + p)).status;
    }
    console.log(JSON.stringify({ configured: health.auth?.configured, codes }));
    server.closeAllConnections?.();
    server.close();
  `;
  const { code, stdout, stderr } = await runNode(['--input-type=module', '-e', script], cleanEnv());
  assert.equal(code, 0, stderr.slice(0, 600));
  const out = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(out.configured, false, 'this control must run with no verifier');
  for (const [route, status] of Object.entries(out.codes)) {
    assert.ok(
      status === 401 || status === 403 || status === 503,
      `${route} answered ${status} on a hosted deployment with no verifier`
    );
  }
});
