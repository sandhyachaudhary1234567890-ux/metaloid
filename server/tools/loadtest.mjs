// Load test for the authenticated product API.
//
// WHAT THIS MEASURES — and what it does not.
//
// It boots a real gateway on this machine with the `local` (file-backed) data
// driver, mints real ES256 JWTs for N simulated accounts, and drives the
// request mix the clients actually make. So the numbers describe **this API
// layer, this process, this disk** — they are a floor, not a capacity claim
// for production Supabase. The Supabase driver replaces a JSON file with a
// network round-trip and Postgres, which is the next thing to measure.
//
// Every simulated account has its own JWT because the gateway rate-limits per
// account: one token would just measure the 429 path.
//
//   node tools/loadtest.mjs                 # 1 / 8 / 32 concurrent workers
//   node tools/loadtest.mjs --levels 1,16,64 --total 4000
//   node tools/loadtest.mjs --json docs/loadtest-local.json

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

// ── args ────────────────────────────────────────────────────────────────
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const LEVELS = String(arg('levels', '1,8,32')).split(',').map(Number).filter(Boolean);
const TOTAL = Number(arg('total', 1200));
const USERS = Number(arg('users', 24));
const JSON_OUT = arg('json', null);

// ── helpers ─────────────────────────────────────────────────────────────
const port = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port: p } = srv.address();
    srv.close(() => resolve(p));
  });
});

async function waitFor(url, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const pemToBuffer = (pem) => Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// ── the request mix ─────────────────────────────────────────────────────
// Weighted like real use: mostly reading history, sometimes writing a turn.
const MIX = [
  { weight: 30, name: 'list conversations', make: (c) => ({ method: 'GET', path: `/api/v1/conversations?limit=30` }) },
  { weight: 40, name: 'read messages', make: (c) => ({ method: 'GET', path: `/api/v1/conversations/${c.conversationId}/messages?limit=50` }) },
  { weight: 12, name: 'append message', make: (c) => ({ method: 'POST', path: `/api/v1/conversations/${c.conversationId}/messages`, body: { role: 'user', content: `load test turn ${c.i}` } }) },
  { weight: 10, name: 'record usage', make: (c) => ({ method: 'POST', path: '/api/v1/usage', body: { provider: 'openrouter', model: 'load-test', status: 'ok', tokens_in: 120, tokens_out: 240, latency_ms: 800 } }) },
  { weight: 5, name: 'list memories', make: () => ({ method: 'GET', path: '/api/v1/memories?limit=30' }) },
  { weight: 3, name: 'new conversation', make: (c) => ({ method: 'POST', path: '/api/v1/conversations', body: { title: `load ${c.i}`, model: 'load-test' } }) },
];
const TOTAL_WEIGHT = MIX.reduce((n, m) => n + m.weight, 0);

function pick(i) {
  let r = (i * 2654435761) % TOTAL_WEIGHT; // deterministic spread, no RNG dependency
  for (const m of MIX) {
    if (r < m.weight) return m;
    r -= m.weight;
  }
  return MIX[0];
}

// ── boot ────────────────────────────────────────────────────────────────
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const PUBLIC_PEM = await exportSPKI(publicKey);
const PRIVATE_PEM = await exportPKCS8(privateKey);
const ENC_KEY = crypto.randomBytes(32).toString('base64');

const gatewayPort = await port();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-load-'));
const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT: String(gatewayPort),
    BIND_HOST: '127.0.0.1',
    OPENROUTER_API_KEY: 'load-test-key-0123456789',
    OPENROUTER_BASE: 'http://127.0.0.1:1/api/v1',
    NVIDIA_ENABLED: 'false',
    METALOID_DATA_DRIVER: 'local',
    METALOID_DATA_DIR: dataDir,
    METALOID_ENCRYPTION_KEYS: `k1:${ENC_KEY}`,
    SUPABASE_JWT_PUBLIC_KEY: PUBLIC_PEM,
    SUPABASE_JWT_AUDIENCE: 'authenticated',
  },
});
child.stdout.on('data', () => {});
child.stderr.on('data', (d) => process.stderr.write(`[gateway] ${d}`));

const base = `http://127.0.0.1:${gatewayPort}`;
await waitFor(`${base}/api/health`);

const signKey = await crypto.subtle.importKey('pkcs8', pemToBuffer(PRIVATE_PEM), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
const mint = (sub) => new SignJWT({ role: 'authenticated', email: `${sub.slice(0, 8)}@load.test` })
  .setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setAudience('authenticated')
  .setIssuedAt().setExpirationTime('2h').sign(signKey);

async function call(token, { method, path: p, body }) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await res.arrayBuffer();
    status = res.status;
  } catch { status = -1; }
  return { ms: performance.now() - t0, status };
}

// ── seed one conversation + some history per account ────────────────────
const accounts = [];
process.stdout.write(`seeding ${USERS} accounts… `);
for (let i = 0; i < USERS; i += 1) {
  const token = await mint(crypto.randomUUID());
  const created = await fetch(`${base}/api/v1/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: `seed ${i}` }),
  });
  if (created.status !== 201) throw new Error(`seed failed with ${created.status}`);
  const id = (await created.json()).conversation.id;
  for (let m = 0; m < 20; m += 1) {
    await call(token, { method: 'POST', path: `/api/v1/conversations/${id}/messages`, body: { role: m % 2 ? 'assistant' : 'user', content: `seeded message ${m} with a realistic amount of text so reads are not trivial.` } });
  }
  accounts.push({ token, conversationId: id, i });
}
console.log('done');

// ── run ─────────────────────────────────────────────────────────────────
async function level(concurrency, total) {
  const latencies = [];
  const statuses = new Map();
  let issued = 0;
  const started = performance.now();

  async function worker(w) {
    for (;;) {
      const i = issued; // eslint-disable-line no-plusplus
      if (i >= total) return;
      issued += 1;
      const account = accounts[(i + w) % accounts.length];
      const step = pick(i);
      const req = step.make({ ...account, i });
      const { ms, status } = await call(account.token, req);
      latencies.push(ms);
      statuses.set(status, (statuses.get(status) || 0) + 1);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w)));
  const wall = (performance.now() - started) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);
  const errors = [...statuses.entries()].filter(([s]) => s !== 200 && s !== 201).reduce((n, [, c]) => n + c, 0);
  return {
    concurrency,
    requests: latencies.length,
    wall_s: Number(wall.toFixed(2)),
    rps: Number((latencies.length / wall).toFixed(0)),
    p50_ms: Number(percentile(sorted, 50).toFixed(1)),
    p95_ms: Number(percentile(sorted, 95).toFixed(1)),
    p99_ms: Number(percentile(sorted, 99).toFixed(1)),
    max_ms: Number(sorted[sorted.length - 1].toFixed(1)),
    errors,
    statuses: Object.fromEntries([...statuses.entries()].sort()),
  };
}

const results = [];
console.log(`\nmetaloid api load test — local driver, ${os.cpus().length} cpu, node ${process.version}`);
console.log(`mix: ${MIX.map((m) => `${m.name} ${m.weight}%`).join(' · ')}`);
console.log(`total per level: ${TOTAL} requests across ${USERS} accounts\n`);
console.log('conc   rps    p50     p95     p99     max     errors');
for (const c of LEVELS) {
  const r = await level(c, TOTAL);
  results.push(r);
  console.log(
    `${String(r.concurrency).padStart(4)}  ${String(r.rps).padStart(5)}  ${String(r.p50_ms).padStart(6)}  ${String(r.p95_ms).padStart(6)}  ${String(r.p99_ms).padStart(6)}  ${String(r.max_ms).padStart(6)}  ${String(r.errors).padStart(6)}`,
  );
  if (r.errors) console.log(`      statuses: ${JSON.stringify(r.statuses)}`);
}

const out = {
  measured_at: new Date().toISOString(),
  host: { platform: process.platform, cpus: os.cpus().length, node: process.version, total_mem_mb: Math.round(os.totalmem() / 1048576) },
  driver: 'local (file-backed JSON)',
  note: 'Measures this API layer on this machine against the local driver — not production Supabase. Production adds a network round-trip per query; re-run against Supabase before quoting capacity.',
  mix: MIX.map((m) => ({ name: m.name, weight: m.weight })),
  accounts: USERS,
  requests_per_level: TOTAL,
  results,
};
if (JSON_OUT) {
  const file = path.isAbsolute(JSON_OUT) ? JSON_OUT : path.join(ROOT, '..', JSON_OUT);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${path.relative(path.join(ROOT, '..'), file)}`);
}

child.kill('SIGKILL');
fs.rmSync(dataDir, { recursive: true, force: true });
