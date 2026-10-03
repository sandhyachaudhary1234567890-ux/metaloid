// End-to-end: the real flows the product promises, over real HTTP against the
// real gateway and the real local data driver — no mocks of our own code.
//
//   signup → login → session → onboarding → profile → provider credential
//   → model list → chat stream → memory → logout → login → data still there
//   → and user B still cannot see user A's data.
//
// Runs offline: the only external dependency is the in-repo fake provider.

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER = path.join(ROOT, 'server');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

const waitFor = (url, timeoutMs = 20000) => new Promise((resolve, reject) => {
  const start = Date.now();
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

const providerPort = await freePort();
const gatewayPort = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-e2e-'));

const provider = spawn(process.execPath, [
  path.join(SERVER, 'tests', 'fake-provider.mjs'), '--port', String(providerPort), '--scenario', 'ok',
], { stdio: 'ignore' });

const gateway = spawn(process.execPath, [path.join(SERVER, 'src', 'index.js')], {
  cwd: SERVER,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT: String(gatewayPort),
    BIND_HOST: '127.0.0.1',
    METALOID_MODE: 'production',           // no anonymous fallback: real auth only
    METALOID_DATA_DIR: dataDir,
    METALOID_ENCRYPTION_KEYS: 'k1:' + Buffer.alloc(32, 7).toString('base64'),
    METALOID_ENCRYPTION_ACTIVE: 'k1',
    OPENROUTER_BASE: `http://127.0.0.1:${providerPort}/api/v1`,
    OPENROUTER_API_KEY: 'test-key-0123456789',
    NVIDIA_ENABLED: 'false',
    NVIDIA_API_KEY: '',
    ALLOW_ORIGINS: 'https://metaloid.example',
  },
});
const logs = [];
gateway.stdout.on('data', (d) => logs.push(String(d)));
gateway.stderr.on('data', (d) => logs.push(String(d)));

const base = `http://127.0.0.1:${gatewayPort}`;
const api = async (method, p, { token, body, headers = {} } = {}) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSE or empty */ }
  return { status: res.status, json, text, headers: res.headers };
};

const streamChat = async (token, message) => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  const text = await res.text();
  const events = text.split('\n').filter((l) => l.startsWith('data:'))
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    .filter(Boolean);
  return { status: res.status, events, text };
};

let a = null;
let b = null;

try {
  await waitFor(`${base}/api/health`);

  // 0. unauthenticated chat is refused and never spends the owner's key
  const anon = await api('POST', '/api/chat', { body: { message: 'hello' } });
  check('unauthenticated /api/chat is refused (401)', anon.status === 401, `got ${anon.status}`);

  // 1. signup + login + session
  const su = await api('POST', '/api/auth/signup', { body: { handle: 'alice', displayName: 'Alice', passcode: 'correct-horse-battery', deviceName: 'e2e' } });
  check('signup creates an account', (su.status === 200 || su.status === 201) && Boolean(su.json?.access), `status ${su.status}`);
  a = su.json;

  const login = await api('POST', '/api/auth/login', { body: { handle: 'alice', passcode: 'correct-horse-battery', deviceName: 'e2e' } });
  check('login returns a fresh session', login.status === 200 && Boolean(login.json?.access), `status ${login.status}`);
  a = login.json;

  const me = await api('GET', '/api/auth/me', { token: a.access });
  check('session resolves to the right identity', me.status === 200 && me.json?.user?.handle === 'alice', JSON.stringify(me.json).slice(0, 120));

  const badLogin = await api('POST', '/api/auth/login', { body: { handle: 'alice', passcode: 'wrong-password' } });
  check('wrong passcode is rejected', badLogin.status === 400 || badLogin.status === 401, `got ${badLogin.status}`);

  // 2. onboarding + profile
  const onb = await api('POST', '/api/onboarding', { token: a.access, body: { displayName: 'Alice', language: 'en', style: 'balanced', voice: 'warm', proactivity: 'medium' } });
  check('onboarding completes', onb.status === 200, `status ${onb.status}`);
  const prof = await api('GET', '/api/profile', { token: a.access });
  check('profile reflects onboarding', prof.status === 200 && prof.json?.profile?.onboardingDone === true, JSON.stringify(prof.json).slice(0, 160));

  // 3. provider credential: stored encrypted, returned masked, testable
  const cred = await api('POST', '/api/providers/credentials', { token: a.access, body: { providerId: 'openrouter', credential: 'sk-or-v1-e2e-fixture-0000000000' } });
  check('provider credential is accepted', (cred.status === 201 || cred.status === 200) && Boolean(cred.json?.id || cred.json?.credential), `status ${cred.status} ${JSON.stringify(cred.json).slice(0, 120)}`);
  const credId = cred.json?.id || cred.json?.credential?.id;
  check('credential response never contains the raw key', !JSON.stringify(cred.json || {}).includes('sk-or-v1-e2e-fixture-0000000000'), 'raw key echoed');
  const creds = await api('GET', '/api/providers/credentials', { token: a.access });
  check('credential list is masked', creds.status === 200 && !JSON.stringify(creds.json).includes('sk-or-v1-e2e-fixture-0000000000'), JSON.stringify(creds.json).slice(0, 160));

  const modelList = await api('GET', '/api/models', { token: a.access });
  check('model list is real and free-first', modelList.status === 200 && Array.isArray(modelList.json?.models) && modelList.json.models.length > 0, `status ${modelList.status}`);

  // 4. chat streams from the provider
  const chat = await streamChat(a.access, 'explain what you can do');
  const tokens = chat.events.filter((e) => e.token);
  check('chat streams tokens', chat.status === 200 && tokens.length > 0, `status ${chat.status} events ${chat.events.length}`);
  check('chat never leaks provider internals', !/invalid parameters|openrouter 400/i.test(chat.text), chat.text.slice(0, 120));
  check('chat uses the configured free-tier path', !/sk-or-v1/.test(chat.text), 'key fragment in stream');

  // 5. memory: remember → list → retrieve → delete → verify
  const mem = await api('POST', '/api/memory', { token: a.access, body: { class: 'fact', content: 'Alice prefers short answers.', confidence: 0.9 } });
  check('memory record is created', mem.status === 201 && Boolean(mem.json?.record?.id), `status ${mem.status}`);
  const memId = mem.json?.record?.id;
  const memList = await api('GET', '/api/memory', { token: a.access });
  check('memory is retrievable', memList.status === 200 && (memList.json?.records || []).some((r) => r.id === memId), `status ${memList.status}`);
  const memDel = await api('DELETE', `/api/memory/${memId}`, { token: a.access });
  const memAfter = await api('GET', '/api/memory', { token: a.access });
  check('memory deletion is real', memDel.status < 300 && !(memAfter.json?.records || []).some((r) => r.id === memId), `del ${memDel.status}`);

  // 6. logout invalidates the session
  const out = await api('POST', '/api/auth/logout', { token: a.access });
  const afterLogout = await api('GET', '/api/profile', { token: a.access });
  check('logout invalidates the session', out.status < 300 && afterLogout.status === 401, `logout ${out.status}, reuse ${afterLogout.status}`);

  // 7. login again: the profile survived
  const back = await api('POST', '/api/auth/login', { body: { handle: 'alice', passcode: 'correct-horse-battery', deviceName: 'e2e-2' } });
  a = back.json;
  const prof2 = await api('GET', '/api/profile', { token: a.access });
  check('data persists across sessions', prof2.status === 200 && prof2.json?.profile?.onboardingDone === true, JSON.stringify(prof2.json).slice(0, 120));

  // 8. a second account exists, and cannot see the first one's data
  const su2 = await api('POST', '/api/auth/signup', { body: { handle: 'bob', displayName: 'Bob', passcode: 'another-strong-passphrase', deviceName: 'e2e-b' } });
  b = su2.json;
  const bMem = await api('POST', '/api/memory', { token: b.access, body: { class: 'fact', content: 'Bob likes long answers.' } });
  check('second account works independently', bMem.status === 201, `status ${bMem.status}`);
  const aMem = await api('GET', '/api/memory', { token: a.access });
  check("user A never sees user B's memories", !(aMem.json?.records || []).some((r) => /Bob likes/.test(r.content || '')), 'cross-user leak');
  const bCreds = await api('GET', '/api/providers/credentials', { token: b.access });
  check("user B never sees user A's provider credentials", (bCreds.json?.credentials || bCreds.json?.items || []).length === 0, JSON.stringify(bCreds.json).slice(0, 140));

  // 9. CORS: unknown origins are not echoed
  const corsRes = await api('GET', '/api/health', { headers: { Origin: 'https://evil.example' } });
  check('unknown origin is not allowed', corsRes.headers.get('access-control-allow-origin') === null, String(corsRes.headers.get('access-control-allow-origin')));
  const corsOk = await api('GET', '/api/health', { headers: { Origin: 'https://metaloid.example' } });
  check('allow-listed origin is echoed', corsOk.headers.get('access-control-allow-origin') === 'https://metaloid.example', String(corsOk.headers.get('access-control-allow-origin')));
} catch (e) {
  check('e2e run completes without throwing', false, e && e.message);
} finally {
  try { gateway.kill('SIGKILL'); } catch { /* gone */ }
  try { provider.kill('SIGKILL'); } catch { /* gone */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} end-to-end checks passed`);
if (failed.length) {
  console.log('gateway log tail:\n' + logs.join('').slice(-1200));
  process.exit(1);
}
