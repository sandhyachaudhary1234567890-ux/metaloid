// Live smoke test through the stack a browser actually uses:
//
//   app origin (5173) → Vite proxy → gateway (8787) → data layer → provider
//
// Run it with the stack already up (`npm run start:all`) rather than spawning
// its own, because the point is to check the assembled product and not a
// process it built for the occasion:
//
//   node scripts/live-smoke.mjs            # uses the local dev stack
//   APP_ORIGIN=https://your.app node scripts/live-smoke.mjs   # against a deploy
//   JWT_SECRET=<the gateway's SUPABASE_JWT_SECRET> node scripts/live-smoke.mjs
//
// It signs an HS256 session token with the gateway's own secret, so it crosses
// the same verification boundary a real Supabase session does. Sections map to
// the core-integrity claims: identity from the session, one account cannot see
// another's rows, keys go in and never come out, the saved model drives the
// next request, and deleting a conversation propagates to history and URLs.
//
// Verdicts
// --------
//   PASS        every check ran against a reachable target and held.  exit 0
//   FAIL        the target answered, and something real was wrong.    exit 1
//   UNVERIFIED  the target could not be reached over the network.     exit 2
//
// UNVERIFIED is not a soft failure and must never be read as success. Most of
// the checks below are negative assertions — "B cannot see A's rows", "the key
// never comes back" — and a dead network satisfies every one of them while
// proving nothing at all. A transport error is therefore never allowed to
// settle a check: it is counted separately, and any transport error anywhere in
// the run downgrades the whole verdict to UNVERIFIED. The reachability gate
// below catches the common case before a single assertion is printed.

import crypto from 'node:crypto';

const APP = process.env.APP_ORIGIN || 'http://127.0.0.1:5173';
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me-32-characters+';
if (!process.env.JWT_SECRET) {
  console.log('(note: using the local dev secret; set JWT_SECRET for any other stack)\n');
}

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const mint = (sub) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, role: 'authenticated', aud: 'authenticated', iss: 'supabase', email: `${sub.slice(0, 4)}@example.test`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};

let pass = 0, fail = 0;
/** Transport failures seen during the run. Non-zero ⇒ the verdict is UNVERIFIED. */
let transportFailures = 0;

const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
};

/** Human-readable cause for a fetch failure, without a stack trace. */
const why = (e) => e?.cause?.code || e?.code || e?.name || 'network error';

/**
 * Record a transport failure and return a result no assertion can satisfy.
 *
 * The shape matches a successful response exactly — including `text` — because
 * callers destructure it, and a missing field would crash the run before the
 * UNVERIFIED verdict could be printed. Failing to report honestly is worse than
 * failing loudly.
 */
const unreachable = (path, e) => {
  transportFailures++;
  console.log(`  ! transport failure on ${path}: ${why(e)}`);
  return { status: 0, unreachable: true, json: {}, text: '' };
};

const req = async (method, path, { token, body, raw } = {}) => {
  let r;
  try {
    r = await fetch(APP + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return unreachable(path, e);
  }
  let text;
  try {
    text = await r.text();
  } catch (e) {
    return unreachable(path, e);
  }
  if (raw) return { status: r.status, text };
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
};

// ── Reachability gate ────────────────────────────────────────────────────
// Nothing below is meaningful if the target is not answering, so ask once,
// plainly, before printing any assertion.
console.log(`live smoke → ${APP}`);
{
  let probe;
  try {
    probe = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    console.log(`\nUNVERIFIED — could not reach ${APP}`);
    console.log(`  reason: ${why(e)}`);
    console.log('  No PASS/FAIL is reported: an unreachable target proves nothing either way.\n');
    process.exit(2);
  }
  // A reachable host that answers badly is a real FAIL, not an unknown — so
  // only transport failure gates here. Status is reported, then measured.
  console.log(`  reachable — /api/health answered HTTP ${probe.status}`);
}

const A = `11111111-2222-4333-8444-${Date.now().toString().slice(-12)}`;
const B = `99999999-8888-4777-8666-${Date.now().toString().slice(-12)}`;
const tokenA = mint(A);
const tokenB = mint(B);

console.log('\n1. health, through the app origin');
const h = await req('GET', '/api/health');
ok('reachable via the 5173 proxy', h.status === 200 && h.json.ok === true, JSON.stringify(h.json).slice(0, 160));
ok('reports a real provider', h.json.ai === true && !!h.json.provider, `ai=${h.json.ai} provider=${h.json.provider}`);
ok('reports the data driver', !!h.json.data?.driver, JSON.stringify(h.json.data));
ok('reports auth configured + mode', h.json.auth?.configured === true, JSON.stringify(h.json.auth));

console.log('\n2. the auth boundary');
ok('no token → 401 no_token', (await req('GET', '/api/v1/me')).json.code === 'no_token');
ok('garbage token → 401', (await req('GET', '/api/v1/me', { token: 'nope' })).status === 401);
const me = await req('GET', '/api/v1/me', { token: tokenA });
ok('valid session identifies the user', me.status === 200 && me.json.profile?.id === A || me.json.user?.id === A, JSON.stringify(me.json).slice(0, 140));

console.log('\n3. a conversation, a message, and history');
const conv = await req('POST', '/api/v1/conversations', { token: tokenA, body: { title: 'live smoke' } });
const cid = conv.json.conversation?.id;
ok('conversation created', conv.status === 201 && !!cid);
const msg = await req('POST', `/api/v1/conversations/${cid}/messages`, { token: tokenA, body: { role: 'user', content: 'hello from the live check' } });
ok('message persisted', msg.status === 201 && !!msg.json.message?.id);
const listed = await req('GET', `/api/v1/conversations/${cid}/messages`, { token: tokenA });
ok('message reads back', listed.json.rows?.length === 1 && listed.json.rows[0].content.includes('live check'));
const bMsgs = await req('GET', `/api/v1/conversations/${cid}/messages`, { token: tokenB });
ok('a second account sees none of it', bMsgs.status === 404 || bMsgs.json.rows?.length === 0, JSON.stringify(bMsgs.json).slice(0, 120));
ok('a second account cannot open the thread', (await req('GET', `/api/v1/conversations/${cid}`, { token: tokenB })).status === 404);

console.log('\n4. credentials: stored, masked, never echoed');
const KEY = 'sk-or-v1-livecheck0000000000000000000000';
const put = await req('PUT', '/api/v1/provider/credentials/openrouter', { token: tokenA, body: { api_key: KEY } });
ok('credential accepted', put.status === 201 || put.status === 200, JSON.stringify(put.json).slice(0, 160));
ok('the key never comes back', !JSON.stringify(put.json).includes(KEY));
const creds = await req('GET', '/api/v1/provider/credentials', { token: tokenA });
ok('listed as a mask', creds.json.credentials?.length === 1 && /…|\.\.\./.test(creds.json.credentials[0].masked || creds.json.credentials[0].masked_hint || ''), JSON.stringify(creds.json).slice(0, 160));
ok('another account sees no credentials', (await req('GET', '/api/v1/provider/credentials', { token: tokenB })).json.credentials?.length === 0);

console.log('\n5. the model choice persists across requests');
const CHOSEN = 'fake/gamma:free';
const saved = await req('PUT', '/api/v1/provider/settings', { token: tokenA, body: { default_provider: 'openrouter', default_model: CHOSEN, free_only: true } });
ok('saved', saved.status === 200, JSON.stringify(saved.json).slice(0, 140));
const reread = await req('GET', '/api/v1/provider/settings', { token: tokenA });
ok('survives a fresh request', reread.json.settings?.default_model === CHOSEN, JSON.stringify(reread.json).slice(0, 140));

console.log('\n6. the saved model actually drives the streamed reply');
const chat = await req('POST', '/api/chat', { token: tokenA, body: { message: 'which model are you', conversationId: cid }, raw: true });
const events = chat.text.split('\n').filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } }).filter(Boolean);
// The implemented protocol is {meta} / {token} / {done} / {error} — cumulative
// text in `token`, matching src/lib/transport.ts. Not the spec's text_delta list.
const text = events.filter((e) => typeof e.token === 'string').map((e) => e.token).join('');
ok('stream opened', chat.status === 200, chat.text.slice(0, 160));
ok('deltas arrived', text.length > 0, `keys: ${[...new Set(events.flatMap((e) => Object.keys(e)))].join(',')}`);
ok('provider was asked for the saved model', text.includes(CHOSEN), `reply=${JSON.stringify(text.slice(0, 120))}`);
ok('done sentinel present', events.some((e) => e.done === true), `keys: ${[...new Set(events.flatMap((e) => Object.keys(e)))].join(',')}`);

console.log('\n7. memory reaches the context engine');
const mem = await req('POST', '/api/v1/memories', { token: tokenA, body: { content: 'prefers very short answers', category: 'Preference' } });
ok('memory saved', mem.status === 201 && !!mem.json.memory?.id);
ok('memory listed for its owner only', (await req('GET', '/api/v1/memories', { token: tokenA })).json.rows?.length >= 1
  && (await req('GET', '/api/v1/memories', { token: tokenB })).json.rows?.length === 0);

console.log('\n8. deleting a conversation propagates');
const del = await req('DELETE', `/api/v1/conversations/${cid}`, { token: tokenA });
ok('delete succeeds, and reports it', del.status >= 200 && del.status < 300 && del.json.deleted === true, JSON.stringify(del.json));
ok('the direct URL no longer exposes it', (await req('GET', `/api/v1/conversations/${cid}`, { token: tokenA })).status === 404);
const hist = await req('GET', '/api/v1/conversations', { token: tokenA });
ok('history no longer lists it', !(hist.json.rows || []).some((c) => c.id === cid));
const goneMsgs = await req('GET', `/api/v1/conversations/${cid}/messages`, { token: tokenA });
ok('its messages are gone too', goneMsgs.status === 404 || goneMsgs.json.rows?.length === 0, JSON.stringify(goneMsgs.json).slice(0, 120));

// ── Verdict ──────────────────────────────────────────────────────────────
// A transport failure anywhere means the run could not be completed, so the
// result is UNVERIFIED and the exit code is non-zero. It is deliberately
// reported before PASS/FAIL: `fail` is meaningless if checks never ran.
const verdict = transportFailures > 0 ? 'UNVERIFIED' : (fail > 0 ? 'FAIL' : 'PASS');

console.log(`\n${pass} passed, ${fail} failed${transportFailures ? `, ${transportFailures} unreachable` : ''}`);
console.log(`VERDICT: ${verdict}`);
if (verdict === 'UNVERIFIED') {
  console.log('  The target was not fully reachable — this run is not evidence of either health or breakage.');
}
console.log('');

process.exitCode = verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2;
