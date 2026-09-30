// HTTP-level multi-user security matrix. Spawns an isolated gateway
// (:8877, temp data dir, 2s access TTL) and hammers the real routes.
// No provider calls (chat stream success path is NOT hit — costs key quota).
(async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawn } = await import('node:child_process');
  const B = 'https://127.0.0.1:8877';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-httptest-'));
  let pass = 0;
  const ok = (n, c) => {
    if (!c) {
      console.error('FAIL', n);
      process.exitCode = 1;
    } else {
      pass += 1;
      console.log('PASS', n);
    }
  };
  const gw = spawn('node', ['server/src/index.js'], {
    cwd: 'C:\\metaloid',
    env: { ...process.env, PORT: '8877', METALOID_DATA_DIR: tmp, METALOID_ACCESS_TTL_MS: '2000', METALOID_AUTH_LIMIT: '1000' },
    stdio: 'ignore',
  });
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
        const h = await fetch(B + '/api/health').then((r) => r.json());
        if (h.ok) break;
      } catch { /* booting */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    const h = await fetch(B + '/api/health').then((r) => r.json());
    ok('health ok + auth flag', h.ok && h.auth === true);

    for (const [m, p, body] of [
      ['GET', '/api/memory'], ['POST', '/api/memory', {}], ['GET', '/api/missions'],
      ['POST', '/api/missions', {}], ['GET', '/api/profile'], ['GET', '/api/usage'],
      ['GET', '/api/devices'], ['GET', '/api/workspaces'], ['POST', '/api/chat', { message: 'hi' }],
      ['GET', '/api/debug/summary'], ['GET', '/api/auth/me'], ['GET', '/api/account/export'],
    ]) {
      const r = await api(m, p, null, body);
      ok(`unauth ${m} ${p} → 401`, r.s === 401);
    }

    const sA = await api('POST', '/api/auth/signup', null, { handle: 'alice', displayName: 'Alice', passcode: 'alice1234' });
    ok('signup A 201 admin', sA.s === 201 && sA.b.user.role === 'admin' && !!sA.b.access);
    const sB = await api('POST', '/api/auth/signup', null, { handle: 'bob', displayName: 'Bob', passcode: 'bob1234' });
    ok('signup B 201 user', sB.s === 201 && sB.b.user.role === 'user');
    let tA = sA.b.access, rA = sA.b.refresh, tB = sB.b.access, rB = sB.b.refresh;
    const A = sA.b.user.id, Bc = sB.b.user.id;

    const memA = await api('POST', '/api/memory', tA, { content: 'Alice private plan' });
    ok('A remember 201 + owner', memA.s === 201 && memA.b.record.userId === A);
    const memB_list = await api('GET', '/api/memory', tB);
    ok('B recall sees nothing', memB_list.s === 200 && memB_list.b.records.length === 0);
    ok('B delete A memory → 404', (await api('DELETE', '/api/memory/' + memA.b.record.id, tB)).s === 404);
    ok('B edit A memory → 404', (await api('PUT', '/api/memory/' + memA.b.record.id, tB, { content: 'x' })).s === 404);

    const misA = await api('POST', '/api/missions', tA, { objective: 'Alice mission objective here' });
    ok('A mission 201', misA.s === 201 && misA.b.mission.userId === A);
    ok('B open A mission → 404', (await api('GET', '/api/missions/' + misA.b.mission.id, tB)).s === 404);
    ok('B run A mission → 404', (await api('POST', '/api/missions/' + misA.b.mission.id + '/run', tB)).s === 404);
    const misB_list = await api('GET', '/api/missions', tB);
    ok('B mission list empty', misB_list.s === 200 && misB_list.b.missions.length === 0);

    const invA = await api('POST', '/api/osint/investigations', tA, { target: 'example.com' });
    ok('A osint 201', invA.s === 201);
    ok('B open A osint → 404', (await api('GET', '/api/osint/investigations/' + invA.b.id, tB)).s === 404);
    const invB_list = await api('GET', '/api/osint/investigations', tB);
    ok('B osint list empty', invB_list.s === 200 && invB_list.b.investigations.length === 0);

    const entA = await api('POST', '/api/world/entities', tA, { type: 'project', name: 'AliceProj' });
    ok('A entity 201', entA.s === 201);
    const entB_q = await api('GET', '/api/world/entities?q=aliceproj', tB);
    ok('B entity search empty', entB_q.s === 200 && entB_q.b.entities.length === 0);
    ok('B relate on A entity → 400', (await api('POST', '/api/world/relate', tB, { from: entA.b.entity.id, to: entA.b.entity.id, rel: 'x' })).s === 400);

    const expB = await api('GET', '/api/account/export', tB);
    ok('B export has no A data', expB.s === 200 && expB.b.memories.length === 0 && expB.b.user.id === Bc);
    ok('B debug → 403 (non-admin)', (await api('GET', '/api/debug/summary', tB)).s === 403);
    ok('A debug → 200 (admin)', (await api('GET', '/api/debug/summary', tA)).s === 200);

    // expiry: 2s TTL
    await new Promise((r) => setTimeout(r, 2500));
    ok('expired access → 401', (await api('GET', '/api/auth/me', tA)).s === 401);
    const ref = await api('POST', '/api/auth/refresh', null, { refresh: rA });
    ok('refresh issues new pair', ref.s === 200 && !!ref.b.access && ref.b.refresh !== rA);
    ok('old refresh dead (rotation)', (await api('POST', '/api/auth/refresh', null, { refresh: rA })).s === 401);
    tA = ref.b.access; rA = ref.b.refresh;
    ok('new access works', (await api('GET', '/api/auth/me', tA)).s === 200);

    // concurrent sessions for B (fresh login: old tokens may have expired)
    const loginB = await api('POST', '/api/auth/login', null, { handle: 'bob', passcode: 'bob1234' });
    ok('B re-login ok', loginB.s === 200);
    tB = loginB.b.access;
    const login2 = await api('POST', '/api/auth/login', null, { handle: 'bob', passcode: 'bob1234' });
    ok('second login ok (multi-device)', login2.s === 200);
    ok('both B sessions valid', (await api('GET', '/api/auth/me', tB)).s === 200 && (await api('GET', '/api/auth/me', login2.b.access)).s === 200);

    // logout kills only that session
    await api('POST', '/api/auth/logout', tB);
    ok('logged-out token dead', (await api('GET', '/api/auth/me', tB)).s === 401);
    ok('other session survives', (await api('GET', '/api/auth/me', login2.b.access)).s === 200);

    // concurrency: 10 parallel users, strict isolation
    const t0 = Date.now();
    const mk = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        api('POST', '/api/auth/signup', null, { handle: 'u' + i + 'x', displayName: 'U' + i, passcode: 'pass1234' })
          .then(async (s) => {
            if (s.s !== 201) {
              console.log('  diag u' + i, 'signup', s.s, JSON.stringify(s.b).slice(0, 120));
              return false;
            }
            const t = s.b.access;
            const w = await api('POST', '/api/memory', t, { content: 'secret-of-u' + i });
            if (w.s !== 201) {
              console.log('  diag u' + i, 'remember', w.s, JSON.stringify(w.b).slice(0, 120));
              return false;
            }
            const list = await api('GET', '/api/memory', t);
            const good = list.s === 200 && list.b.records.length === 1 && list.b.records[0].content === 'secret-of-u' + i;
            if (!good) console.log('  diag u' + i, 'recall', list.s, JSON.stringify(list.b).slice(0, 160));
            return good;
          })
      )
    );
    ok('10 parallel users isolated', mk.every(Boolean));
    console.log('INFO 10-user setup+write+read took ' + (Date.now() - t0) + 'ms');

    // delete cascade via API (fresh owner token: TTL may have lapsed)
    const loginB2 = await api('POST', '/api/auth/login', null, { handle: 'bob', passcode: 'bob1234' });
    ok('B fresh login for deletion', loginB2.s === 200);
    const delB = await api('DELETE', '/api/account', loginB2.b.access, { confirm: 'DELETE' });
    if (delB.s !== 200) console.log('  diag delete', delB.s, JSON.stringify(delB.b).slice(0, 200));
    ok('B account deleted', delB.s === 200);
    ok('B cannot log back in', (await api('POST', '/api/auth/login', null, { handle: 'bob', passcode: 'bob1234' })).s === 401);
    const expA = await api('GET', '/api/account/export', tA);
    ok('A data intact after B deletion', expA.s === 200 && expA.b.memories.some((m) => m.content === 'Alice private plan'));
  } finally {
    gw.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(pass + ' HTTP CHECKS PASSED' + (process.exitCode ? ' (WITH FAILURES)' : ''));
})();
