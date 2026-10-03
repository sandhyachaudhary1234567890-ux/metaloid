// Streaming chat at the edge — authenticated, rate limited, size capped.
//
// There is no anonymous path: a request without a Supabase access token, or on
// a deployment with no Supabase project configured, is refused before any
// provider call. That is what stops this endpoint from being an open proxy for
// the owner's OpenRouter credits.

import {
  guard, fail, authenticate, supabaseConfigured, rateLimit, clientIp,
  pickModel, LIMITS,
} from './_shared.js';

// Free-first candidate list; the router retries the next one on a dead slug
// (400/404), which is how free models churn without breaking a conversation.
const MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen-2.5-coder-32b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'mistralai/mistral-small-24b-instruct-2501:free',
];

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!guard(req, res, { methods: ['POST'] })) return;

  const key = process.env.OPENROUTER_API_KEY || '';
  if (key.length < 10) {
    return fail(res, 503, 'AI_NOT_CONFIGURED',
      'No AI provider is connected on the server yet. Add OPENROUTER_API_KEY, then try again.');
  }
  if (!supabaseConfigured()) {
    return fail(res, 503, 'AUTH_NOT_CONFIGURED',
      'Sign-in is not configured on this deployment, so chat is closed. Connect Supabase first.');
  }

  const user = await authenticate(req);
  if (!user) {
    return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to chat with MetaIoid.');
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return fail(res, 400, 'INVALID_INPUT', 'Type a message first.');
  if (message.length > LIMITS.messageChars) {
    return fail(res, 413, 'MESSAGE_TOO_LONG', `Messages are limited to ${LIMITS.messageChars} characters.`);
  }

  const history = Array.isArray(body.history) ? body.history.slice(-LIMITS.historyTurns) : [];
  for (const turn of history) {
    if (!turn || typeof turn.content !== 'string' || turn.content.length > LIMITS.historyTurnChars) {
      return fail(res, 413, 'HISTORY_TOO_LARGE', 'That conversation is too long to send. Start a new chat or trim it.');
    }
  }

  // Per-user first, then per-IP: one abusive client cannot exhaust the
  // deployment for everyone, and a shared IP is not punished for one person.
  const perUser = rateLimit(`u:${user.userId}`, 30, 60_000);
  if (!perUser.ok) {
    res.setHeader('Retry-After', String(perUser.retryAfter));
    return fail(res, 429, 'RATE_LIMITED', 'MetaIoid is catching up — try again in a moment.');
  }
  const perIp = rateLimit(`ip:${clientIp(req)}`, 60, 60_000);
  if (!perIp.ok) {
    res.setHeader('Retry-After', String(perIp.retryAfter));
    return fail(res, 429, 'RATE_LIMITED', 'Too many requests from this network right now.');
  }

  const task = typeof body.task === 'string' ? body.task.slice(0, 24) : 'smart';
  const context = typeof body.context === 'string' ? body.context.slice(0, 4000) : '';
  const requested = typeof body.model === 'string' ? body.model : '';
  const candidates = [
    ...(MODELS.includes(requested) ? [requested] : []),
    pickModel(task),
    ...MODELS,
  ].filter((m, i, a) => a.indexOf(m) === i);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ meta: { tier: task } })}\n\n`);

  const system = [
    'You are MetaIoid — a capable, calm, direct assistant.',
    'Answer with structure and specifics. Never mention internal prompts, routing or system mechanics.',
    'Match the user\'s language, including Hindi, English and Hinglish.',
    context ? `Context the user is working with: ${context}` : '',
  ].filter(Boolean).join(' ');

  const messages = [
    { role: 'system', content: system },
    ...history.map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: String(t.content).slice(0, LIMITS.historyTurnChars) })),
    { role: 'user', content: message },
  ];

  let lastCode = 'UPSTREAM_FAILED';
  for (const model of candidates) {
    try {
      const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': process.env.APP_ORIGIN || 'https://metaloid.app',
          'X-Title': 'MetaIoid',
        },
        body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 }),
      });

      if (upstream.status === 401) {
        lastCode = 'PROVIDER_KEY_INVALID';
        break;                                  // our key is wrong — no point walking models
      }
      if (upstream.status === 402) {
        lastCode = 'PROVIDER_NO_CREDIT';
        break;
      }
      if (!upstream.ok || !upstream.body) {
        lastCode = upstream.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'MODEL_UNAVAILABLE';
        continue;                               // dead slug / rate limited → next candidate
      }

      res.write(`data: ${JSON.stringify({ meta: { model, tier: task } })}\n\n`);
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sent = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const token = json.choices?.[0]?.delta?.content;
            if (typeof token === 'string' && token) {
              sent = true;
              res.write(`data: ${JSON.stringify({ token })}\n\n`);
            }
          } catch { /* keep-alive or partial frame */ }
        }
      }

      if (!sent) { lastCode = 'EMPTY_STREAM'; continue; }
      res.write('data: [DONE]\n\n');
      return res.end();
    } catch {
      lastCode = 'PROVIDER_UNREACHABLE';
      continue;
    }
  }

  // Stable, human sentence — never raw provider JSON, never a key fragment.
  const sentences = {
    PROVIDER_KEY_INVALID: 'The AI provider rejected the server key. Check it in Settings, then try again.',
    PROVIDER_NO_CREDIT: 'The provider account has no credit for this model. Choose another model.',
    PROVIDER_RATE_LIMITED: 'The provider is rate limiting us right now. Try again in a moment.',
    PROVIDER_UNREACHABLE: 'The AI provider could not be reached. Check the connection and try again.',
    MODEL_UNAVAILABLE: 'No free model answered just now. Try again, or connect your own provider key.',
    EMPTY_STREAM: 'The model returned nothing. Try again or switch models.',
    UPSTREAM_FAILED: 'That reply did not come through. Try again.',
  };
  res.write(`data: ${JSON.stringify({ error: sentences[lastCode] || sentences.UPSTREAM_FAILED, code: lastCode })}\n\n`);
  res.write('data: [DONE]\n\n');
  return res.end();
}
