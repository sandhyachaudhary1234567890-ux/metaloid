// Model layer: OpenRouter free-model router + streaming.
// - Lists live models, filters `:free`, classifies by capability.
// - Task router picks fast / smart / vision / coding.
// - Streams SSE tokens; never logs keys.

const BASE = 'https://openrouter.ai/api/v1';
let cache = { at: 0, models: [] };
const CACHE_MS = 5 * 60 * 1000;

const FALLBACK_FREE = [
  // last-resort only (used when /models is unreachable); free slugs churn,
  // prefer the live list. Verified working 2026-09-19:
  { id: 'nex-agi/nex-n2.5-pro:free', name: 'Nex N2.5 Pro (free)', tier: 'smart' },
  { id: 'qwen/qwen3.8-27b:free', name: 'Qwen3 27B (free)', tier: 'smart' },
];

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
    const r = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(8000) });
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
  const want = task === 'vision' ? ['vision', 'smart', 'fast']
    : task === 'coding' ? ['coding', 'smart', 'fast']
    : task === 'fast' ? ['fast', 'smart']
    : task === 'voice' ? ['fast', 'smart'] // spoken replies favor first-token latency
    : ['smart', 'coding', 'fast'];
  for (const tier of want) {
    const m = models.find((x) => x.tier === tier);
    if (m) return m;
  }
  return models[0] || FALLBACK_FREE[0];
}

/** Ordered candidates for try-next failover (same tier first). */
export function pickCandidates(models, task, max = 3) {
  const want = task === 'vision' ? ['vision', 'smart', 'fast']
    : task === 'coding' ? ['coding', 'smart', 'fast']
    : task === 'fast' ? ['fast', 'smart']
    : task === 'voice' ? ['fast', 'smart']
    : ['smart', 'coding', 'fast'];
  const out = [];
  for (const tier of want) {
    for (const m of models) {
      if (m.tier === tier && !out.some((x) => x.id === m.id)) out.push(m);
      if (out.length >= max) return out;
    }
  }
  for (const m of models) {
    if (!out.some((x) => x.id === m.id)) out.push(m);
    if (out.length >= max) break;
  }
  return out.length ? out : [FALLBACK_FREE[0]];
}

/** Retryable provider failures: dead slugs (404) + rate limits (429). */
export function retryableProviderError(e) {
  return /openrouter (404|429)/.test(String((e && e.message) || e || ''));
}

export function classifyTask(message) {
  const t = message.toLowerCase();
  if (/code|debug|function|regex|python|javascript|typescript|sql|error|stack trace/.test(t)) return 'coding';
  if (/(seeing|showing|image|photo|camera|look at|vision)/.test(t)) return 'vision';
  if (message.length < 120 && /^(hi|hello|hey|thanks|ok|bye|namaste|ram ram)\b/.test(t.trim())) return 'fast';
  return 'smart';
}

const SYSTEM_FALLBACK = `You are METALOID, a private personal AI assistant. Be concise unless complexity demands detail. Mirror Hindi/Hinglish/English. Never invent sources, tools, or results. Disagree respectfully when the user is wrong.`;

export async function streamChat({ apiKey, model, messages, signal, onToken, system }) {
  const sys = system && system.trim() ? system : SYSTEM_FALLBACK;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'METALOID',
    },
    body: JSON.stringify({
      model: model.id,
      stream: true,
      messages: [{ role: 'system', content: sys }, ...messages],
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`openrouter ${res.status} ${text.slice(0, 200)}`);
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
        const delta = j.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onToken(full);
        }
      } catch { /* partial chunk — ignore */ }
    }
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'METALOID',
    },
    body: JSON.stringify({
      model: mdl.id,
      stream: false,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: sys }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content || '', model: mdl.id };
}
