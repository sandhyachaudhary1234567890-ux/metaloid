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
//   APP_ORIGIN=https://your.app JWT_SECRET=<secure-HS256-secret> node scripts/live-smoke.mjs
//
// A real Supabase project normally uses asymmetric JWKS signing. In that case
// do not forge a token with a JWT secret: provide two real, short-lived access
// tokens through the secure environment as LIVE_SMOKE_TOKEN_A and
// LIVE_SMOKE_TOKEN_B (or SUPABASE_ACCESS_TOKEN_A/B). The script also supports
// secure password sign-in for dedicated smoke accounts with
// LIVE_SMOKE_EMAIL_A/B and LIVE_SMOKE_PASSWORD_A/B plus the Supabase URL and
// anon key in the environment. Passwords and tokens are never printed.
//
// The HS256 path remains for local/legacy projects and only uses a secret that
// was explicitly supplied for a remote target. Sections map to the
// core-integrity claims: identity from the session, one account cannot see
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
const LOCAL_APP = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(APP);
const DEFAULT_LOCAL_SECRET = 'dev-only-secret-change-me-32-characters+';
const SECRET = String(process.env.JWT_SECRET || (LOCAL_APP ? DEFAULT_LOCAL_SECRET : '')).trim();
const ACCESS_A = String(process.env.LIVE_SMOKE_TOKEN_A || process.env.SUPABASE_ACCESS_TOKEN_A || '').trim();
const ACCESS_B = String(process.env.LIVE_SMOKE_TOKEN_B || process.env.SUPABASE_ACCESS_TOKEN_B || '').trim();
const EMAIL_A = String(process.env.LIVE_SMOKE_EMAIL_A || process.env.SUPABASE_SMOKE_EMAIL_A || '').trim();
const EMAIL_B = String(process.env.LIVE_SMOKE_EMAIL_B || process.env.SUPABASE_SMOKE_EMAIL_B || '').trim();
const PASSWORD_A = String(process.env.LIVE_SMOKE_PASSWORD_A || process.env.SUPABASE_SMOKE_PASSWORD_A || '');
const PASSWORD_B = String(process.env.LIVE_SMOKE_PASSWORD_B || process.env.SUPABASE_SMOKE_PASSWORD_B || '');

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const mint = (sub) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const issuer = process.env.JWT_ISSUER || process.env.SUPABASE_JWT_ISSUER || 'supabase';
  const audience = process.env.JWT_AUDIENCE || process.env.SUPABASE_JWT_AUDIENCE || 'authenticated';
  const p = b64({ sub, role: 'authenticated', aud: audience, iss: issuer, email: `${sub.slice(0, 4)}@example.test`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};

/** Decode only the subject needed to label assertions. The gateway still
 * verifies the complete token; this local decode never establishes trust. */
function subjectOf(token, label) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`${label} is not a JWT access token`);
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch {
    throw new Error(`${label} has an unreadable JWT payload`);
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error(`${label} has no user subject`);
  return payload.sub;
}

async function passwordToken(label, email, password) {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anon = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anon) throw new Error(`${label} password sign-in needs SUPABASE_URL and SUPABASE_ANON_KEY in the secure environment`);
  let response;
  try {
    response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`${label} Supabase password sign-in was unreachable`);
  }
  if (!response.ok) throw new Error(`${label} Supabase password sign-in failed (HTTP ${response.status})`);
  const body = await response.json().catch(() => ({}));
  if (typeof body.access_token !== 'string' || !body.access_token) throw new Error(`${label} Supabase sign-in returned no access token`);
  return body.access_token;
}

/** Resolve a genuine pair of identities for a production run. */
async function resolveAuth() {
  let tokenA = ACCESS_A;
  let tokenB = ACCESS_B;
  const suppliedTokens = Boolean(tokenA || tokenB);
  if (suppliedTokens && (!tokenA || !tokenB)) {
    throw new Error('provide both LIVE_SMOKE_TOKEN_A and LIVE_SMOKE_TOKEN_B for cross-user checks');
  }
  if (!suppliedTokens && (EMAIL_A || EMAIL_B || PASSWORD_A || PASSWORD_B)) {
    if (!EMAIL_A || !EMAIL_B || !PASSWORD_A || !PASSWORD_B) {
      throw new Error('provide both LIVE_SMOKE_EMAIL_A/B and LIVE_SMOKE_PASSWORD_A/B for password sign-in');
    }
    tokenA = await passwordToken('A', EMAIL_A, PASSWORD_A);
    tokenB = await passwordToken('B', EMAIL_B, PASSWORD_B);
  }
  if (!tokenA && !tokenB) {
    if (!SECRET) {
      throw new Error('no authenticated smoke credentials: use real access tokens, dedicated Supabase smoke-account sign-in, or JWT_SECRET for a legacy HS256 target');
    }
    if (!process.env.JWT_SECRET && !LOCAL_APP) {
      throw new Error('JWT_SECRET is required when targeting a remote HS256 deployment');
    }
    if (!process.env.JWT_SECRET) console.log('(note: using the local dev secret)\n');
    const suffix = Date.now().toString().slice(-12);
    tokenA = mint(`11111111-2222-4333-8444-${suffix}`);
    tokenB = mint(`99999999-8888-4777-8666-${suffix}`);
  }
  const A = subjectOf(tokenA, 'A');
  const B = subjectOf(tokenB, 'B');
  if (A === B) throw new Error('smoke identities A and B must be different users');
  return { A, B, tokenA, tokenB, realSessions: suppliedTokens || Boolean(EMAIL_A || EMAIL_B) };
}

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

let auth;
try {
  auth = await resolveAuth();
} catch (e) {
  console.log('\nUNVERIFIED — authenticated smoke credentials are not available');
  console.log(`  reason: ${e instanceof Error ? e.message : 'secure auth setup failed'}`);
  console.log('  No PASS/FAIL is reported: production ownership and persistence were not exercised.\n');
  process.exit(2);
}
const { A, B, tokenA, tokenB } = auth;

console.log('\n1. health, through the app origin');
const h = await req('GET', '/api/health');
ok('reachable via the 5173 proxy', h.status === 200 && h.json.ok === true, JSON.stringify(h.json).slice(0, 160));
ok('reports a real provider', h.json.ai === true && !!h.json.provider, `ai=${h.json.ai} provider=${h.json.provider}`);
ok('reports the data driver', !!h.json.data?.driver, JSON.stringify(h.json.data));
ok('reports auth configured + mode', h.json.auth?.configured === true, JSON.stringify(h.json.auth));

console.log('\n2. the auth boundary');
ok('no token → 401 no_token', (await req('GET', '/api/v1/me')).json.code === 'no_token');
ok('garbage token → 401', (await req('GET', '/api/v1/me', { token: 'nope' })).status === 401);
const unauthChat = await req('POST', '/api/chat', { body: { message: 'unauthenticated probe' } });
ok('unauthenticated /api/chat is rejected', unauthChat.status === 401 && !unauthChat.text, JSON.stringify(unauthChat.json).slice(0, 140));
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
// Remove the synthetic key before chat. Production chat must exercise the
// configured platform provider, not accidentally route through a fake BYOK key.
const credentialGone = await req('DELETE', '/api/v1/provider/credentials/openrouter', { token: tokenA });
ok('smoke credential can be removed', credentialGone.status === 200 && credentialGone.json.deleted === true, JSON.stringify(credentialGone.json));

console.log('\n5. the model choice persists across requests');
const catalog = await req('GET', '/api/models');
const catalogModels = Array.isArray(catalog.json.models) ? catalog.json.models : [];
const CHOSEN = String(process.env.LIVE_SMOKE_MODEL || catalogModels[1]?.id || catalogModels[0]?.id || '').trim();
ok('free model catalogue is reachable', catalog.status === 200 && catalogModels.length > 0 && catalogModels.every((m) => String(m.id || '').endsWith(':free')), JSON.stringify(catalog.json).slice(0, 180));
const saved = await req('PUT', '/api/v1/provider/settings', { token: tokenA, body: { default_provider: 'openrouter', default_model: CHOSEN, free_only: true } });
ok('saved', saved.status === 200 && !!CHOSEN, JSON.stringify(saved.json).slice(0, 140));
const reread = await req('GET', '/api/v1/provider/settings', { token: tokenA });
ok('survives a fresh request', reread.json.settings?.default_model === CHOSEN, JSON.stringify(reread.json).slice(0, 140));

console.log('\n6. the saved model actually drives the streamed reply');
const chat = await req('POST', '/api/chat', { token: tokenA, body: { message: 'which model are you', conversationId: cid }, raw: true });
const events = chat.text.split('\n').filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } }).filter(Boolean);
// The implemented protocol is {meta} / {retry} / {token} / {done} / {error} —
// cumulative text in `token`, matching src/lib/transport.ts. Retry and error
// are conditional events; a successful turn must still expose meta, token and
// done without leaking provider JSON.
const text = events.filter((e) => typeof e.token === 'string').map((e) => e.token).pop() || '';
const meta = events.find((e) => e.meta)?.meta || {};
ok('stream opened', chat.status === 200, chat.text.slice(0, 160));
ok('meta event present', !!meta.model && !!meta.provider, `keys: ${[...new Set(events.flatMap((e) => Object.keys(e)))].join(',')}`);
ok('token event arrived', text.length > 0, `keys: ${[...new Set(events.flatMap((e) => Object.keys(e)))].join(',')}`);
ok('provider used the saved free model', meta.model === CHOSEN && String(meta.model).endsWith(':free'), `chosen=${CHOSEN} used=${meta.model || 'none'}`);
ok('successful stream has no error event', !events.some((e) => e.error), JSON.stringify(events.filter((e) => e.error)).slice(0, 160));
ok('done sentinel present', events.some((e) => e.done === true), `keys: ${[...new Set(events.flatMap((e) => Object.keys(e)))].join(',')}`);

// The browser mirrors the completed assistant turn through this same v1
// message contract. Exercise the write and read-back against the real driver.
const assistant = await req('POST', `/api/v1/conversations/${cid}/messages`, {
  token: tokenA,
  body: { role: 'assistant', content: text, model: meta.model, provider: meta.provider },
});
ok('assistant response persisted', assistant.status === 201 && !!assistant.json.message?.id);
const afterChat = await req('GET', `/api/v1/conversations/${cid}/messages`, { token: tokenA });
ok('user + assistant history reads back', afterChat.json.rows?.length === 2 && afterChat.json.rows[1]?.role === 'assistant' && afterChat.json.rows[1]?.content === text);

console.log('\n7. memory reaches the context engine');
const mem = await req('POST', '/api/v1/memories', { token: tokenA, body: { content: 'prefers very short answers', category: 'Preference' } });
const memoryId = mem.json.memory?.id;
ok('memory saved', mem.status === 201 && !!memoryId);
const aMemories = await req('GET', '/api/v1/memories', { token: tokenA });
const bMemories = await req('GET', '/api/v1/memories', { token: tokenB });
ok('memory listed for its owner only', aMemories.json.rows?.some((row) => row.id === memoryId) && bMemories.json.rows?.every((row) => row.id !== memoryId));
const memoryGone = await req('DELETE', `/api/v1/memories/${memoryId}`, { token: tokenA });
ok('memory can be removed by its owner', memoryGone.status === 200 && memoryGone.json.deleted === true);

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
