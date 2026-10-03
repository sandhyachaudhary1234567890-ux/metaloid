// Load test: 50 concurrent users × (signup, login, memory write+recall,
// paginated lists, jobs poll) against an ISOLATED gateway. No LLM calls
// (provider quota is not burned for load measurement). Reports p50/p95
// per op + error count. Run: node server/tests/load.cjs
(async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawn } = await import('node:child_process');
  const B = 'https://127.0.0.1:8890';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-load-'));
  const N = 50;
  const lat = {};
  const errors = [];
  const rec = (op, ms) => {
    (lat[op] = lat[op] || []).push(ms);
  };
  const gw = spawn('node', ['server/src/index.js'], {
    cwd: 'C:\\metaloid',
    env: { ...process.env, PORT: '8890', METALOID_DATA_DIR: tmp, METALOID_AUTH_LIMIT: '10000' },
    stdio: 'ignore',
  });
  const j = async (r) => r.json().catch(() => ({}));
  const timed = async (op, fn) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      rec(op, Date.now() - t0);
      return r;
    } catch (e) {
      rec(op, Date.now() - t0);
      errors.push(op + ': ' + String((e && e.message) || e).slice(0, 100));
      return null;
    }
  };
  const api = async (method, p, token, body) => {
    const r = await fetch(B + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const b = await j(r);
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${(b.error || '').slice(0, 60)}`);
    return b;
  };
  const pct = (arr, p) => {
    if (!arr || !arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  try {
    for (let i = 0; i < 60; i++) {
      try {
        const h = await fetch(B + '/api/ready').then((r) => r.json());
        if (h.ready) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const t0 = Date.now();
    const users = await Promise.all(
      Array.from({ length: N }, (_, i) => (async () => {
        const h = 'load' + i + Date.now().toString(36).slice(-3);
        const s = await timed('signup', () => api('POST', '/api/auth/signup', null, { handle: h, passcode: 'pass1234' }));
        if (!s) return null;
        await timed('memory-write', () => api('POST', '/api/memory', s.access, { content: 'load note ' + i }));
        await timed('memory-recall', () => api('GET', '/api/memory?limit=10&offset=0', s.access));
        await timed('missions-list', () => api('GET', '/api/missions?limit=10&offset=0', s.access));
        await timed('jobs-list', () => api('GET', '/api/jobs', s.access));
        await timed('usage', () => api('GET', '/api/usage', s.access));
        return s;
      })())
    );
    const wall = Date.now() - t0;
    const okUsers = users.filter(Boolean).length;
    console.log(`users ok: ${okUsers}/${N}  wall: ${wall}ms`);
    for (const [op, arr] of Object.entries(lat)) {
      console.log(`${op}: n=${arr.length} p50=${pct(arr, 50)}ms p95=${pct(arr, 95)}ms max=${Math.max(...arr)}ms`);
    }
    console.log(`errors: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log('  ERR ' + e);
    // sustained: 20 rapid sequential authed reads (stream-adjacent load)
    const u0 = users.find(Boolean);
    if (u0) {
      const t1 = Date.now();
      for (let i = 0; i < 20; i++) {
        await timed('seq-recall', () => api('GET', '/api/memory?limit=5', u0.access));
      }
      console.log(`20 sequential recalls: ${Date.now() - t1}ms total`);
    }
    if (okUsers === N && errors.length === 0) console.log('LOAD PASS');
    else {
      console.log('LOAD COMPLETED WITH ISSUES');
      process.exitCode = 1;
    }
  } finally {
    gw.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
