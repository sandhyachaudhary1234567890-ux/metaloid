// Supabase-mode matrix: runs the gateway with SUPABASE_DB=supabase against
// the REAL project and verifies Postgres-backed domains end-to-end.
// All fixtures use `sbmode*` handles and are deleted afterwards.
// Run: node server/tests/supabase-mode.cjs
(async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawn } = await import('node:child_process');
  const { base } = require('./_scheme.cjs');
  const B = base(8892);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-sbmode-'));
  let pass = 0;
  const ok = (n, c, extra = '') => {
    if (!c) {
      console.error('FAIL', n, extra);
      process.exitCode = 1;
    } else {
      pass += 1;
      console.log('PASS', n);
    }
  };
  const env = { ...process.env, METALOID_NO_DOTENV: '1', PORT: '8892', METALOID_DATA_DIR: tmp, METALOID_AUTH_LIMIT: '1000', SUPABASE_DB: 'supabase' };
  // inherit server/.env Supabase vars
  try {
    const dotenv = fs.readFileSync(path.join(process.cwd(), 'server', '.env'), 'utf8');
    for (const line of dotenv.split('\n')) {
      const m = line.match(/^\s*(SUPABASE_[A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch {}

  // This matrix is the only one that talks to the real project, so it can only
  // run where one is reachable. Without a connection string the gateway would
  // quietly fall back to the local store and every assertion below would be
  // testing the wrong driver — and the requests would hang rather than fail,
  // which is how this script used to stall the whole chain. Say so and leave.
  if (!String(env.SUPABASE_DB_POOL_URL || '').trim()) {
    console.log('SKIP supabase-mode: SUPABASE_DB_POOL_URL is not set.');
    console.log('     Paste the Transaction pooler URL (dashboard → Connect) into server/.env,');
    console.log('     then apply supabase/bootstrap.sql in the SQL editor and re-run.');
    return;
  }

  const gw = spawn(process.execPath, ['server/src/index.js'], { cwd: require('node:path').resolve(__dirname, '..', '..'), env, stdio: 'ignore' });
  const j = async (r) => r.json().catch(() => ({}));
  const api = async (method, p, token, body) => {
    const r = await fetch(B + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { s: r.status, b: await j(r) };
  };
  try {
    for (let i = 0; i < 40; i++) {
      try {
        const h = await fetch(B + '/api/ready').then((r) => r.json());
        if (h.ready) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const sA = await api('POST', '/api/auth/signup', null, { handle: 'sbmodea', passcode: 'pass1234' });
    const sB = await api('POST', '/api/auth/signup', null, { handle: 'sbmodeb', passcode: 'pass1234' });
    ok('signup A/B in supabase mode', sA.s === 201 && sB.s === 201);
    const tA = sA.b.access, tB = sB.b.access;

    // memories → Postgres
    const m1 = await api('POST', '/api/memory', tA, { content: 'sbmode memory alpha' });
    ok('remember 201 (pg)', m1.s === 201 && /^[0-9a-f-]{36}$/.test(m1.b.record.id), 'uuid id, got ' + (m1.b.record && m1.b.record.id));
    const mid = m1.b.record.id;
    const lr = await api('GET', '/api/memory?q=alpha', tA);
    ok('recall finds it (pg)', lr.s === 200 && lr.b.records.length === 1);
    const up = await api('PUT', '/api/memory/' + mid, tA, { content: 'sbmode memory beta' });
    ok('update (pg)', up.s === 200 && up.b.record.content === 'sbmode memory beta');
    ok('B cannot read A memory', (await api('GET', '/api/memory?q=beta', tB)).b.records.length === 0);
    ok('B cannot delete A memory', (await api('DELETE', '/api/memory/' + mid, tB)).s === 404);
    ok('secret-shaped refused (pg)', (await api('POST', '/api/memory', tA, { content: 'api-key: sk-or-1234567890abcdef' })).s === 400);

    // credentials → Postgres (AES parity: decrypt round-trips via adapter path)
    const c1 = await api('POST', '/api/providers/credentials', tA, { providerId: 'openai', credential: 'sk-sbmode-testkey-1234567890' });
    ok('store cred 201 (pg), redacted only', c1.s === 201 && !!c1.b.redacted && !c1.b.credential);
    const cid = c1.b.id;
    const cl = await api('GET', '/api/providers/credentials', tA);
    ok('list shows it, no secret', cl.s === 200 && cl.b.credentials.length === 1 && JSON.stringify(cl.b).indexOf('sk-sbmode') === -1);
    ok('B list empty (pg isolation)', (await api('GET', '/api/providers/credentials', tB)).b.credentials.length === 0);
    ok('B rotate A cred → 404', (await api('PUT', `/api/providers/credentials/${cid}`, tB, { credential: 'x' })).s === 404);
    const rt = await api('PUT', `/api/providers/credentials/${cid}`, tA, { credential: 'sk-sbmode-rotated-1234567890' });
    ok('rotate ok (pg)', rt.s === 200 && rt.b.rotationCount === 1);
    const au = await api('GET', `/api/providers/credentials/${cid}/audit`, tA);
    ok('audit trail in pg', au.s === 200 && au.b.auditLog.length >= 2);

    // usage → Postgres
    const u1 = await api('GET', '/api/usage', tA);
    ok('usage summary shape (pg)', u1.s === 200 && u1.b.plan === 'free' && typeof u1.b.chat.usedToday === 'number');

    // provider ordering still works with pg-backed creds (no adapter call, just order)
    const del = await api('DELETE', '/api/account', tA, { confirm: 'DELETE' });
    ok('A account deleted (cascade incl. pg)', del.s === 200);
    const delB = await api('DELETE', '/api/account', tB, { confirm: 'DELETE' });
    ok('B account deleted', delB.s === 200);
  } finally {
    gw.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(pass + ' SUPABASE-MODE CHECKS PASSED' + (process.exitCode ? ' (WITH FAILURES)' : ''));
})();
