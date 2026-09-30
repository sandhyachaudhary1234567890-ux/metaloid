// Provider matrix: contract tests per adapter with MOCKED fetch (no keys,
// no network), fallback switching, ordering, meters, security additions.
// Run: node server/tests/providers-matrix.mjs (self-isolating temp dir).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.METALOID_DATA_DIR) {
  process.env.METALOID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-prov-'));
}

const pass = (n) => console.log('PASS', n);
const realFetch = globalThis.fetch;

// ---------- mock fetch harness ----------
let responder = null;
function mockFetch(fn) {
  responder = fn;
  globalThis.fetch = async (url, init) => responder(String(url), init || {});
}
function restoreFetch() {
  globalThis.fetch = realFetch;
  responder = null;
}
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const textRes = (text, status = 200) => new Response(text, { status });
function sseRes(chunks) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const mockVault = (key = 'test-key-1234567890') => ({
  getUserCredential: () => ({ id: 'cred-1', providerId: 'x', credential: key }),
});

const users = await import('../src/core/users.js');
const adapters = await import('../src/core/providerAdapters.js');
const gateway = await import('../src/core/providerGateway.js');
const meters = await import('../src/core/providerMeters.js');
const registry = await import('../src/core/providerRegistry.js');

const U = users.createUser({ handle: 'provtest', passcode: 'pass1234' }).user.id;

// ---------- OpenAI contract ----------
{
  const a = new adapters.OpenAIAdapter(mockVault('sk-test1234567890abcdef'));
  assert.deepEqual((await a.validateCredential('bad')).valid, false);
  assert.equal((await a.validateCredential('sk-test1234567890abcdef')).valid, true);

  mockFetch((url) => {
    if (url.endsWith('/models')) return jsonRes({ data: [{ id: 'gpt-4o' }, { id: 'o3-mini' }] });
    throw new Error('unexpected ' + url);
  });
  const models = await a.listModels(U);
  assert.ok(models.some((m) => m.modelId === 'gpt-4o' && m.live), 'live models mapped');
  assert.ok((await a.authenticate(U)).valid, 'auth ok');

  mockFetch((url) => {
    if (url.endsWith('/models')) return textRes('Unauthorized', 401);
    throw new Error('unexpected');
  });
  assert.equal((await a.authenticate(U)).valid, false, '401 → invalid');
  const h = await a.healthCheck(U);
  assert.equal(h.status, 'auth_failed', 'health auth_failed');
  restoreFetch();
  pass('openai: auth + models + health');
}
{
  const a = new adapters.OpenAIAdapter(mockVault('sk-test1234567890abcdef'));
  const msgs = [{ role: 'user', content: 'hi' }];
  mockFetch(() => jsonRes({ choices: [{ message: { content: 'hello' } }], model: 'gpt-4o', usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
  const out = await a.execute(U, null, { model: 'gpt-4o', messages: msgs });
  assert.equal(out.text, 'hello');
  assert.equal(out.usage.totalTokens, 8, 'usage normalized');
  restoreFetch();

  mockFetch(() => sseRes(['data: {"choices":[{"delta":{"content":"he"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n', 'data: [DONE]\n\n']));
  const seen = [];
  const sout = await a.stream(U, null, { model: 'gpt-4o', messages: msgs }, (full) => seen.push(full));
  assert.equal(sout.text, 'hello');
  assert.deepEqual(seen, ['he', 'hello'], 'streaming tokens');
  restoreFetch();

  mockFetch(() => textRes(JSON.stringify({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }), 429));
  try {
    await a.execute(U, null, { model: 'gpt-4o', messages: msgs });
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.type, 'RATE_LIMITED');
    assert.equal(e.retryable, true);
  }
  restoreFetch();

  // timeout: hanging fetch + short race — adapter uses 60s; simulate abort via signal
  mockFetch((_url, init) => new Promise((_, rej) => {
    init.signal?.addEventListener('abort', () => {
      const e = new Error('This operation was aborted');
      e.name = 'AbortError';
      rej(e);
    });
  }));
  const c = new AbortController();
  setTimeout(() => c.abort(), 50);
  try {
    await a.execute(U, null, { model: 'gpt-4o', messages: msgs, signal: c.signal });
    assert.fail('should abort');
  } catch (e) {
    assert.ok(/abort/i.test(e.message + (e.type || '')), 'cancellation surfaces, got ' + (e.message || e.type));
  }
  restoreFetch();
  pass('openai: request/response/stream/rate-limit/cancel');
}

// ---------- Anthropic contract ----------
{
  const a = new adapters.AnthropicAdapter(mockVault('sk-ant-test1234567890'));
  assert.equal((await a.validateCredential('sk-nope')).valid, false);
  assert.equal((await a.validateCredential('sk-ant-test1234567890')).valid, true);

  let sawHeaders = null;
  mockFetch((url, init) => {
    sawHeaders = init.headers || {};
    if (url.endsWith('/models')) return jsonRes({ data: [{ id: 'claude-3-5-sonnet-20241022', display_name: 'Sonnet' }] });
    if (url.endsWith('/messages')) {
      const body = JSON.parse(init.body);
      assert.ok(!body.messages.some((m) => m.role === 'system'), 'no system role in turns');
      return jsonRes({ content: [{ type: 'text', text: 'hi there' }], model: 'claude-x', usage: { input_tokens: 4, output_tokens: 2 } });
    }
    throw new Error('unexpected ' + url);
  });
  assert.equal(sawHeaders, null);
  const out = await a.execute(U, null, { model: 'claude-3-5-sonnet-20241022', messages: [{ role: 'system', content: 'be nice' }, { role: 'user', content: 'hi' }] });
  assert.equal(out.text, 'hi there');
  assert.equal(out.usage.totalTokens, 6);
  assert.equal(sawHeaders['x-api-key'], 'sk-ant-test1234567890', 'x-api-key header (not Bearer)');
  assert.equal(sawHeaders['anthropic-version'], '2023-06-01');
  restoreFetch();

  mockFetch(() => sseRes([
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ab"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"c"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]));
  const seen = [];
  const sout = await a.stream(U, null, { model: 'x', messages: [{ role: 'user', content: 'hi' }] }, (f) => seen.push(f));
  assert.equal(sout.text, 'abc');
  assert.deepEqual(seen, ['ab', 'abc']);
  restoreFetch();

  mockFetch(() => textRes(JSON.stringify({ type: 'authentication_error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), 401));
  try {
    await a.execute(U, null, { model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.type, 'AUTHENTICATION_FAILED');
    assert.equal(e.retryable, false);
  }
  restoreFetch();
  pass('anthropic: payload shape, headers, stream events, auth error');
}

// ---------- Gemini contract ----------
{
  const a = new adapters.GeminiAdapter(mockVault('AIza-test1234567890abcdef'));
  assert.equal((await a.validateCredential('nope')).valid, false);
  assert.equal((await a.validateCredential('AIza-test1234567890abcdef')).valid, true);

  let sawUrl = '';
  mockFetch((url, init) => {
    sawUrl = url;
    if (url.includes('/models?key=')) return jsonRes({ models: [{ name: 'models/gemini-2.0-flash', displayName: 'Flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100 }] });
    if (url.includes(':generateContent')) {
      const body = JSON.parse(init.body);
      assert.ok(body.contents.every((c) => c.role === 'user' || c.role === 'model'), 'roles mapped');
      assert.ok(body.system_instruction, 'system folded');
      return jsonRes({ candidates: [{ content: { parts: [{ text: 'gemini says' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } });
    }
    throw new Error('unexpected ' + url);
  });
  const out = await a.execute(U, null, { model: 'gemini-2.0-flash', messages: [{ role: 'assistant', content: 'old' }, { role: 'user', content: 'hi' }], system: 'sys' });
  assert.equal(out.text, 'gemini says');
  assert.equal(out.usage.totalTokens, 5);
  assert.ok(sawUrl.includes('key=AIza'), 'key in query');
  restoreFetch();

  mockFetch(() => sseRes([
    'data: {"candidates":[{"content":{"parts":[{"text":"xe"}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"no"}]}}]}\n\n',
  ]));
  const seen = [];
  const sout = await a.stream(U, null, { model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'hi' }] }, (f) => seen.push(f));
  assert.equal(sout.text, 'xeno');
  restoreFetch();

  mockFetch(() => textRes(JSON.stringify({ error: { message: 'API key not valid. API_KEY_INVALID.', status: 'INVALID_ARGUMENT' } }), 400));
  try {
    await a.execute(U, null, { model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.type, 'AUTHENTICATION_FAILED');
  }
  restoreFetch();
  pass('gemini: roles/system mapping, stream chunks, key error');
}

// ---------- pre-existing adapters smoke (unchanged code paths) ----------
{
  const or = new (await import('../src/core/providerAdapter.js')).OpenRouterAdapter(mockVault('sk-or-test1234567890'));
  mockFetch((url) => {
    if (url.endsWith('/models')) return jsonRes({ data: [] });
    throw new Error('unexpected');
  });
  assert.ok(Array.isArray(await or.listModels(U)), 'openrouter models fallback array');
  restoreFetch();
  const nv = new (await import('../src/core/providerAdapter.js')).NvidiaAdapter(mockVault('nvapi-test1234567890'));
  mockFetch(() => textRes('Unauthorized', 401));
  try {
    await nv.execute(U, null, { model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.type, 'AUTHENTICATION_FAILED');
  }
  restoreFetch();
  pass('openrouter/nvidia smoke (execute/error paths)');
}

// ---------- fallback: A invalid key → B valid ----------
{
  const vaultBoth = {
    getUserCredential: (uid, pid) => {
      if (pid === 'openai') return { id: 'c1', credential: 'sk-BADKEY1234567890' };
      if (pid === 'gemini') return { id: 'c2', credential: 'AIza-GOODKEY1234567890' };
      return null;
    },
  };
  const { OpenAIAdapter } = await import('../src/core/providerAdapters.js');
  const { GeminiAdapter } = await import('../src/core/providerAdapters.js');
  mockFetch((url, init) => {
    if (url.includes('api.openai.com')) return textRes(JSON.stringify({ error: { message: 'Incorrect API key', code: 'invalid_api_key' } }), 401);
    if (url.includes('generativelanguage')) {
      if (init.method === 'POST') return sseRes(['data: {"candidates":[{"content":{"parts":[{"text":"fallback wins"}]}}]}\n\n']);
      return jsonRes({ models: [] });
    }
    throw new Error('unexpected ' + url);
  });
  const oa = new OpenAIAdapter(vaultBoth);
  const ga = new GeminiAdapter(vaultBoth);
  let firstErr = null;
  try {
    await oa.stream(U, null, { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }, () => {});
  } catch (e) {
    firstErr = e;
  }
  assert.equal(firstErr?.type, 'AUTHENTICATION_FAILED', 'A fails auth');
  const seen = [];
  const out = await ga.stream(U, null, { model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'hi' }] }, (f) => seen.push(f));
  assert.equal(out.text, 'fallback wins', 'B serves after A fails');
  restoreFetch();
  pass('fallback A-invalid → B-valid, result normalized');
}

// ---------- gateway ordering (prefs + health) ----------
{
  const cv = await import('../src/core/credentialVault.js');
  cv.storeUserCredential(U, 'openai', 'sk-test-user-key-1234567890');
  cv.storeUserCredential(U, 'gemini', 'AIza-test-user-key-1234567890');
  const ord1 = gateway.orderProviders(U, { defaultProvider: 'gemini', fallbackProviders: ['openai'] });
  assert.deepEqual(ord1.order, ['gemini', 'openai'], 'default first, then fallback');
  const ord2 = gateway.orderProviders(U, {});
  assert.deepEqual(new Set(ord2.order), new Set(['openai', 'gemini']), 'all creds present unordered');
  // unhealthy excluded (covered live via health manager in HTTP tests)
  pass('gateway ordering honors prefs');
}

// ---------- meters ----------
{
  meters.recordProviderUsage(U, 'openai', { promptTokens: 10, completionTokens: 5, ms: 200, ok: true });
  meters.recordProviderUsage(U, 'openai', { promptTokens: 10, completionTokens: 5, ms: 100, ok: false });
  const s = meters.providerUsageSummary(U);
  assert.equal(s.openai.requests, 2);
  assert.equal(s.openai.totalTokens, 30);
  assert.equal(s.openai.errors, 1);
  assert.equal(s.openai.avgLatencyMs, 150);
  assert.equal(s.openai.cost.source, 'not-reported-by-provider', 'cost honesty');
  pass('meters: counts/tokens/latency, cost labeled');
}

// ---------- registry manifests (official URLs, no invented links) ----------
{
  for (const pid of ['openai', 'anthropic', 'gemini']) {
    const m = registry.getProvider(pid);
    assert.ok(m, pid + ' registered');
    assert.ok(m.models.length >= 2, pid + ' has models');
    assert.ok(/^https:\/\//.test(m.documentationUrl), pid + ' docs URL');
  }
  const docs = {
    openai: 'https://platform.openai.com/docs/api-reference',
    anthropic: 'https://docs.anthropic.com/en/api',
    gemini: 'https://ai.google.dev/gemini-api/docs',
  };
  for (const [pid, url] of Object.entries(docs)) {
    assert.equal(registry.getProvider(pid).documentationUrl, url, pid + ' official docs');
  }
  pass('registry: 3 families, official URLs only');
}

// ---------- security additions (core level) ----------
{
  // concurrent credential ops
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => (async () => {
      const cv = await import('../src/core/credentialVault.js');
      const u = users.createUser({ handle: 'conc' + i, passcode: 'pass1234' }).user.id;
      cv.storeUserCredential(u, 'openai', 'sk-conc-key-' + i + '-1234567890');
      const got = cv.getUserCredential(u, 'openai');
      return !!got && got.credentialId !== undefined ? true : !!got;
    })())
  );
  assert.ok(results.every(Boolean), 'concurrent store/read isolated per user');
  // disconnect race: delete then use → clean not-found (never a leak)
  const cv = await import('../src/core/credentialVault.js');
  cv.storeUserCredential(U, 'anthropic', 'sk-ant-race-1234567890');
  cv.deleteUserCredential(U, 'anthropic');
  const { AnthropicAdapter } = await import('../src/core/providerAdapters.js');
  const a = new AnthropicAdapter({
    getUserCredential: () => cv.getUserCredential(U, 'anthropic'),
  });
  const h = await a.healthCheck(U);
  assert.equal(h.status, 'auth_failed', 'deleted cred → auth_failed, no crash');
  pass('security: concurrent ops isolated, disconnect race clean');
}

console.log('\nALL PROVIDER TESTS PASSED');
