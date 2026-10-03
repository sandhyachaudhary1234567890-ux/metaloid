// Provider HTTP matrix: auth gates, cross-user credential isolation,
// routing validation, help URLs, adapter flags. Spawns isolated gateway.
(async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawn } = await import('node:child_process');
  const B = 'https://127.0.0.1:8881';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-provhttp-'));
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
  const gw = spawn(process.execPath, ['server/src/index.js'], {
    cwd: require('node:path').resolve(__dirname, '..', '..'),
    env: { ...process.env, PORT: '8881', METALOID_DATA_DIR: tmp, METALOID_ACCESS_TTL_MS: '2000', METALOID_AUTH_LIMIT: '1000' },
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
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    for (const [m, p, b] of [
      ['GET', '/api/providers'], ['GET', '/api/providers/credentials'],
      ['POST', '/api/providers/credentials', {}], ['GET', '/api/providers/routing'],
      ['GET', '/api/providers/usage'], ['GET', '/api/providers/openai/help'],
    ]) {
      ok(`unauth ${m} ${p} → 401`, (await api(m, p, null, b)).s === 401);
    }
    const sA = await api('POST', '/api/auth/signup', null, { handle: 'pva', passcode: 'pass1234' });
    const sB = await api('POST', '/api/auth/signup', null, { handle: 'pvb', passcode: 'pass1234' });
    const tA = sA.b.access;
    const tB = sB.b.access;
    const lp = await api('GET', '/api/providers', tA);
    ok('5 families listed w/ adapter flags', lp.s === 200 && lp.b.providers.length >= 5 && lp.b.providers.every((p) => typeof p.adapter === 'boolean'));
    ok('openai/anthropic/gemini have adapters', ['openai', 'anthropic', 'gemini'].every((id) => lp.b.providers.find((p) => p.providerId === id)?.adapter));
    const help = await api('GET', '/api/providers/openai/help', tA);
    ok('help has official key URL', help.s === 200 && help.b.keyUrl === 'https://platform.openai.com/api-keys');
    const st = await api('POST', '/api/providers/credentials', tA, { providerId: 'openai', credential: 'sk-testuserkey1234567890' });
    ok('store credential 201, redacted only', st.s === 201 && !!st.b.id && !!st.b.redacted && !st.b.credential && !('encryptedData' in st.b));
    const cid = st.b.id;
    const bRead = await api('GET', '/api/providers/credentials/' + cid, tB);
    ok('B cannot read A credential → 404', bRead.s === 404);
    ok('B cannot test A credential → 404', (await api('POST', `/api/providers/credentials/${cid}/test`, tB)).s === 404);
    ok('B cannot rotate A credential → 404', (await api('PUT', `/api/providers/credentials/${cid}`, tB, { credential: 'x' })).s === 404);
    ok('B cannot delete A credential → 404', (await api('DELETE', `/api/providers/credentials/${cid}`, tB)).s === 404);
    ok('B audit of A credential → 404', (await api('GET', `/api/providers/credentials/${cid}/audit`, tB)).s === 404);
    const aList = await api('GET', '/api/providers/credentials', tA);
    ok('A sees own credential', aList.s === 200 && aList.b.credentials.length === 1);
    ok('no raw secret in list', JSON.stringify(aList.b).indexOf('sk-testuserkey') === -1);
    ok('routing rejects unknown provider', (await api('PUT', '/api/providers/routing', tA, { defaultProvider: 'nope' })).s === 400);
    const rt = await api('PUT', '/api/providers/routing', tA, { defaultProvider: 'openai', fallbackProviders: ['gemini'], favoriteModels: ['openai:gpt-4o'] });
    ok('routing saved', rt.s === 200 && rt.b.routing.defaultProvider === 'openai' && rt.b.routing.fallbackProviders[0] === 'gemini');
    const uso = await api('GET', '/api/providers/usage', tA);
    ok('usage endpoint ok', uso.s === 200 && typeof uso.b.usage === 'object');
    const usoB = await api('GET', '/api/providers/usage', tB);
    ok('B usage isolated (empty)', usoB.s === 200 && Object.keys(usoB.b.usage).length === 0);
    await new Promise((r) => setTimeout(r, 2500));
    ok('expired session → 401 on providers', (await api('GET', '/api/providers', tA)).s === 401);
    const li = await api('POST', '/api/auth/login', null, { handle: 'pva', passcode: 'pass1234' });
    const tA2 = li.b.access;
    const del = await api('DELETE', `/api/providers/credentials/${cid}`, tA2);
    ok('disconnect works', del.s === 200);
    ok('credential gone after disconnect', (await api('GET', '/api/providers/credentials', tA2)).b.credentials.length === 0);
  } finally {
    gw.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(pass + ' PROVIDER HTTP CHECKS PASSED' + (process.exitCode ? ' (WITH FAILURES)' : ''));
})();
