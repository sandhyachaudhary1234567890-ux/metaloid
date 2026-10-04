// Model layer: OpenRouter free-model router + streaming.
// - Lists live models, filters `:free`, classifies by capability.
// - Task router picks fast / smart / vision / coding.
// - Streams SSE tokens; never logs keys.
//
// Failure discipline (learned the hard way):
//   free slugs churn constantly, and a dead slug comes back as an HTTP 400
//   "The request contains invalid parameters" — not a 404. So every model
//   rejection must be retryable with the NEXT candidate, and a rejected
//   slug gets quarantined so we never burn a second request on it.

// OPENROUTER_BASE exists for two real needs: pointing at a compatible
// gateway/proxy, and letting the test suite drive failover against a fake
// provider instead of the internet. Defaults to the public API.
const BASE = (process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');

/**
 * Pointed at anything other than the real API (tests, local demo, a proxy)?
 * Then say so everywhere, loudly. A demo that silently impersonates a live
 * model is the one thing this codebase refuses to ship.
 */
export const PROVIDER_IS_MOCK = !/(^|\.)openrouter\.ai/.test(new URL(BASE).hostname);
export const PROVIDER_LABEL = PROVIDER_IS_MOCK ? 'local-mock' : 'openrouter';
let cache = { at: 0, models: [] };
const CACHE_MS = 5 * 60 * 1000;

// Slugs the provider has rejected this process lifetime (dead / unentitled).
// Kept out of every candidate list so one bad slug can never wedge a reply.
const quarantined = new Map(); // id -> { at, reason }
const QUARANTINE_MS = 60 * 60 * 1000;

/**
 * Explicit operator override: OPENROUTER_MODEL="vendor/model:free".
 * Always tried first (so a known-good model can be pinned without a deploy
 * of new code), but never trusted blindly — it still fails over.
 */
const ENV_MODEL = (process.env.OPENROUTER_MODEL || '').trim();

/**
 * Last-resort catalogue, used ONLY when GET /models is unreachable.
 * These are long-lived, widely-mirrored free slugs. They are candidates,
 * not promises: whatever the provider rejects is quarantined and skipped.
 */
const FALLBACK_FREE = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)', tier: 'smart' },
  { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek V3 (free)', tier: 'smart' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B (free)', tier: 'smart' },
  { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B (free)', tier: 'fast' },
  { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (free)', tier: 'fast' },
  { id: 'microsoft/phi-3-medium-128k-instruct:free', name: 'Phi-3 Medium (free)', tier: 'fast' },
];

function isQuarantined(id) {
  const q = quarantined.get(id);
  if (!q) return false;
  if (Date.now() - q.at > QUARANTINE_MS) {
    quarantined.delete(id);
    return false;
  }
  return true;
}

/** Mark a slug unusable for a while (dead, unentitled, rate-limited hard). */
export function markModelDead(id, reason = 'rejected') {
  if (!id) return;
  quarantined.set(id, { at: Date.now(), reason: String(reason).slice(0, 120) });
}

/**
 * Catalogue reachability — the honest "can this server actually talk to the
 * provider right now" signal. cache is only populated by a SUCCESSFUL
 * GET /models, so a populated cache proves outbound network + a live API.
 */
export function catalogueStatus() {
  return {
    ok: cache.models.length > 0,
    at: cache.at ? new Date(cache.at).toISOString() : null,
    count: cache.models.length,
  };
}

export function modelHealth() {
  return {
    quarantined: [...quarantined.entries()].map(([id, v]) => ({ id, reason: v.reason, at: new Date(v.at).toISOString() })),
    override: ENV_MODEL || null,
    cached: cache.models.length,
  };
}

function classify(id) {
  const s = id.toLowerCase();
  if (/vision|vl-|image|llava|qwen.*vl/.test(s)) return 'vision';
  if (/code|coder|dev-|starcoder|deepseek.*coder/.test(s)) return 'coding';
  if (/8b|7b|mini|flash|haiku|3b|1b/.test(s)) return 'fast';
  return 'smart';
}

export async function listFreeModels() {
  if (Date.now() - cache.at < CACHE_MS && cache.models.length) return cache.models;
  try {
    // 5s, not 8s: on serverless (Vercel ~10s first-byte budget) a slow
    // catalogue fetch must fail fast to the static fallback, not eat the
    // whole function budget before the chat stream even starts.
    const ms = Number(process.env.METALOID_MODELS_TIMEOUT_MS || 5000);
    const r = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`models ${r.status}`);
    const j = await r.json();
    const free = (j.data || [])
      .filter((m) => typeof m.id === 'string' && m.id.endsWith(':free'))
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        tier: classify(m.id),
        context: m.context_length || null,
      }));
    if (free.length) {
      cache = { at: Date.now(), models: free };
      return free;
    }
  } catch {
    /* fall through to static fallback */
  }
  return FALLBACK_FREE;
}

export function pickModel(models, task) {
  const live = models.filter((m) => !isQuarantined(m.id));
  for (const tier of tiersFor(task)) {
    const m = live.find((x) => x.tier === tier);
    if (m) return m;
  }
  return live[0] || FALLBACK_FREE[0];
}

function tiersFor(task) {
  if (task === 'vision') return ['vision', 'smart', 'fast'];
  if (task === 'coding') return ['coding', 'smart', 'fast'];
  if (task === 'fast' || task === 'voice') return ['fast', 'smart'];
  return ['smart', 'coding', 'fast'];
}

/**
 * Ordered candidates for try-next failover.
 * ENV override first, then same-tier → other tiers, then anything live.
 * Quarantined slugs are never returned.
 */
export function pickCandidates(models, task, max = 4, preferredModel = '') {
  const live = models.filter((m) => !isQuarantined(m.id));
  const out = [];
  const push = (m) => {
    if (m && !out.some((x) => x.id === m.id)) out.push(m);
  };
  if (ENV_MODEL) {
    const envModel = models.find((m) => m.id === ENV_MODEL) || { id: ENV_MODEL, name: ENV_MODEL, tier: task };
    push(envModel);
  }
  // A signed-in user's saved model is an explicit choice, so honour it before
  // task-tier ordering when it is still present in the live free catalogue.
  // Never manufacture a candidate for a stale slug: falling back to the live
  // free list is safer than sending a retired or paid model to the provider.
  if (preferredModel) push(live.find((m) => m.id === preferredModel));
  for (const tier of tiersFor(task)) {
    for (const m of live) {
      if (m.tier === tier) push(m);
      if (out.length >= max) return out;
    }
  }
  for (const m of live) {
    push(m);
    if (out.length >= max) break;
  }
  // Everything live is quarantined (or the list is empty): reset the board
  // rather than refusing to answer — a fresh hour beats a dead gateway.
  if (!out.length) {
    quarantined.clear();
    return [models[0] || FALLBACK_FREE[0], ...FALLBACK_FREE].slice(0, max).map((m) => ({
      id: m.id, name: m.name || m.id, tier: m.tier || task,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Error discipline: one classifier decides retry-vs-surface, one humanizer
// turns provider noise into something a person can act on.
// ---------------------------------------------------------------------------

/**
 * providerError: attach the HTTP status + raw body to the Error so callers
 * can reason about it without string-sniffing.
 */
function providerError(status, body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const e = new Error(`openrouter ${status}${text ? ` ${text}` : ''}`);
  e.provider = 'openrouter';
  e.status = status;
  e.providerBody = text;
  return e;
}

/**
 * Retryable = "the NEXT candidate might work".
 * 400 is included on purpose: a dead free slug is reported by OpenRouter as
 * 400 "invalid parameters / not a valid model", and treating it as fatal was
 * exactly the bug that surfaced raw provider errors to the user.
 * 401/402 are account-level: another model will not fix a bad key or an
 * empty balance, so those surface immediately with a clear message.
 */
export function retryableProviderError(e) {
  const status = e && e.status;
  if (status) {
    if (status === 401 || status === 402) return false;
    if (status === 400 || status === 403 || status === 404 || status === 408 || status === 429) return true;
    if (status >= 500) return true;
    return false;
  }
  const msg = String((e && e.message) || e || '');
  if (/openrouter (401|402)/.test(msg)) return false;
  if (/openrouter (400|403|404|408|429|5\d\d)/.test(msg)) return true;
  // network / timeout / socket noise → a retry is cheap and often works
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|aborted|timeout|terminated/i.test(msg);
}

/** True when the failure means "this exact slug is unusable". */
export function modelSpecificFailure(e) {
  const s = e && e.status;
  if (s === 400 || s === 403 || s === 404) return true;
  const msg = String((e && e.message) || '');
  return /openrouter (400|403|404)/.test(msg);
}

/**
 * User-facing text. Never leak provider JSON into the UI: the app shows a
 * short, honest sentence and keeps the detail in the server log.
 */
export function humanizeProviderError(e) {
  const status = e && e.status;
  if (e && e.code === 'NO_PROVIDER') return 'No AI provider is connected yet — add a provider key in Settings → AI.';
  if (e && e.code === 'credential_unreadable') return 'Your saved provider key can no longer be decrypted — replace it in Settings → AI.';
  if (e && e.code === 'CLIENT_GONE') return 'Request cancelled.';
  if (status === 401) return 'The provider rejected the API key. Check OPENROUTER_API_KEY.';
  if (status === 402) return 'The provider account is out of credit.';
  if (status === 429) return 'Every free model is rate-limited right now. Try again in a minute.';
  if (status === 400 || status === 404) return 'No free model accepted the request. Pick a model in Settings and retry.';
  if (status >= 500) return 'The model provider is having trouble. Retrying usually works.';
  const msg = String((e && e.message) || '');
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(msg)) return 'Cannot reach the model provider from this server (no outbound network).';
  if (/aborted|timeout/i.test(msg)) return 'The model took too long and was stopped. Try a shorter question.';
  return 'The model provider failed. Retry, or switch model in Settings.';
}

export function classifyTask(message) {
  const t = message.toLowerCase();
  if (/code|debug|function|regex|python|javascript|typescript|sql|error|stack trace/.test(t)) return 'coding';
  if (/(seeing|showing|image|photo|camera|look at|vision)/.test(t)) return 'vision';
  if (message.length < 120 && /^(hi|hello|hey|thanks|ok|bye|namaste|ram ram)\b/.test(t.trim())) return 'fast';
  return 'smart';
}

const SYSTEM_FALLBACK = `You are METALOID, a private personal AI assistant. Be concise unless complexity demands detail. Mirror Hindi/Hinglish/English. Never invent sources, tools, or results. Disagree respectfully when the user is wrong.`;

function headers(apiKey) {
  const referer = process.env.PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || 'http://localhost:5173';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': referer,
    'X-Title': 'METALOID',
  };
}

export async function streamChat({ apiKey, model, messages, signal, onToken, system }) {
  const sys = system && system.trim() ? system : SYSTEM_FALLBACK;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: headers(apiKey),
    // Deliberately minimal body: extra knobs (temperature, max_tokens,
    // stream_options) are rejected outright by some free endpoints. A 400
    // here must mean "try another model", not "our payload is wrong".
    body: JSON.stringify({
      model: model.id,
      stream: true,
      messages: [{ role: 'system', content: sys }, ...messages],
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw providerError(res.status, text);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        // SSE-level errors arrive *inside* a 200 stream (rate limit mid-flight,
        // provider hiccup). Surface them so failover can react.
        if (j.error) {
          const e = providerError(j.error.code || 502, j.error.message || 'stream error');
          throw e;
        }
        const delta = j.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onToken(full);
        }
      } catch (err) {
        if (err && err.provider) throw err; // our own provider error
        /* partial JSON chunk — wait for more */
      }
    }
  }
  if (!full) {
    // A 200 with zero tokens is a silent failure — treat as a dead candidate.
    const e = providerError(502, 'empty stream');
    throw e;
  }
  return full;
}

/** Non-streaming completion for mission synthesis / classification. Small, capped. */
export async function complete({ apiKey, model, messages, system, maxTokens = 1200 }) {
  const sys = system && system.trim() ? system : SYSTEM_FALLBACK;
  const mdl = typeof model === 'string' ? { id: model } : model;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: headers(apiKey),
    body: JSON.stringify({
      model: mdl.id,
      stream: false,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: sys }, ...messages],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw providerError(res.status, text);
  }
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content || '', model: mdl.id };
}
