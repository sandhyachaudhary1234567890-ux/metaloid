// Real provider adapters: OpenAI, Anthropic, Google Gemini.
// Each extends the canonical ProviderAdapter contract (auth, models,
// request, response, stream, error, timeout, rate-limit, cancellation).
// Provider-specific wire differences stay INSIDE adapters; callers only
// see normalized {text, model, usage} and ErrorTypes.
// Docs: https://platform.openai.com/docs/api-reference
//       https://docs.anthropic.com/en/api
//       https://ai.google.dev/gemini-api/docs

import { ProviderAdapter, ErrorTypes } from './providerAdapter.js';
import * as credentialVault from './credentialVault.js';

const TIMEOUT_EXEC = 60000;
const TIMEOUT_FAST = 8000;

function timeoutSignal(ms, outer) {
  if (!outer) return AbortSignal.timeout(ms);
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new Error('timeout')), ms);
  outer.addEventListener('abort', () => {
    clearTimeout(t);
    c.abort(outer.reason);
  }, { once: true });
  return c.signal;
}

/**
 * Shared SSE reader. Handles OpenAI-style (`data:` JSON / [DONE]) and
 * Anthropic-style (`event:` + `data:`) streams. Calls onDelta(text) per
 * chunk; returns when the provider closes the stream.
 */
export async function readSSEStream(response, handlers, signal) {
  if (!response.body) throw new Error('Empty stream body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = '';
  const done = () => {
    try {
      reader.cancel();
    } catch { /* settled */ }
  };
  if (signal) {
    signal.addEventListener('abort', done, { once: true });
  }
  try {
    for (;;) {
      const { done: d, value } = await reader.read();
      if (d) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) {
          event = '';
          continue;
        }
        if (s.startsWith('event:')) {
          event = s.slice(6).trim();
          continue;
        }
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (data === '[DONE]') {
          if (handlers.onDone) handlers.onDone();
          return;
        }
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          continue; // partial chunk
        }
        if (handlers.onEvent) handlers.onEvent(event, json);
      }
    }
  } finally {
    done();
  }
  if (handlers.onDone) handlers.onDone();
}

async function readErrorText(res) {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return '';
  }
}

function credOf(adapter, userId) {
  const c = adapter.credentialVault.getUserCredential(userId, adapter.providerId);
  if (!c) {
    const e = new Error('Credential not found. Connect this provider first.');
    e.code = 'NO_CREDENTIAL';
    throw e;
  }
  return c.credential;
}

// ---------------- OpenAI ----------------

const OPENAI_MODELS = [
  { modelId: 'gpt-4o', displayName: 'GPT-4o', capabilities: { text: true, vision: true, functionCalling: true, streaming: true }, contextLimit: 128000, modalities: ['text', 'image'] },
  { modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini', capabilities: { text: true, vision: true, functionCalling: true, streaming: true }, contextLimit: 128000, modalities: ['text', 'image'] },
  { modelId: 'o3-mini', displayName: 'o3-mini (reasoning)', capabilities: { text: true, reasoning: true, functionCalling: true, streaming: true }, contextLimit: 200000, modalities: ['text'] },
];

export function openaiCapabilities(modelId) {
  const id = String(modelId || '').toLowerCase();
  const caps = { text: true, streaming: true };
  if (/gpt-4o|gpt-4\.1|vision/.test(id)) {
    caps.vision = true;
    caps.functionCalling = true;
  }
  if (/^o[13]|reasoning/.test(id)) caps.reasoning = true;
  return caps;
}

export class OpenAIAdapter extends ProviderAdapter {
  constructor(vault = credentialVault) {
    super('openai', vault);
    this.baseUrl = 'https://api.openai.com/v1';
  }

  async validateCredential(credential) {
    if (typeof credential !== 'string' || !(credential.startsWith('sk-')) || credential.length < 20) {
      return { valid: false, error: 'Invalid OpenAI key format (starts with sk-).' };
    }
    return { valid: true };
  }

  async authenticate(userId) {
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    if (!key) return { valid: false, error: 'Credential not found' };
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key.credential}` },
        signal: AbortSignal.timeout(TIMEOUT_FAST),
      });
      if (res.status === 401) return { valid: false, error: 'Key rejected by OpenAI (401).' };
      if (!res.ok) return { valid: false, error: `OpenAI models check failed (${res.status}).` };
      return { valid: true };
    } catch (e) {
      return { valid: false, error: `Unreachable: ${String(e.message || e).slice(0, 120)}` };
    }
  }

  async listModels(userId) {
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    try {
      if (!key) throw new Error('no-credential');
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key.credential}` },
        signal: AbortSignal.timeout(TIMEOUT_FAST),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const ids = ((data && data.data) || []).map((m) => m.id).filter((id) => /^gpt-|^o[13]-|^chatgpt-/.test(id));
      if (!ids.length) throw new Error('no chat models listed');
      return ids.slice(0, 60).map((id) => ({
        modelId: id, displayName: id, capabilities: openaiCapabilities(id),
        contextLimit: null, streaming: true, async: false, availability: 'public', live: true,
      }));
    } catch {
      return OPENAI_MODELS.map((m) => ({ ...m, streaming: true, async: false, availability: 'public', live: false }));
    }
  }

  _body(model, messages, system, stream, maxTokens) {
    return {
      model, stream,
      max_tokens: maxTokens,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    };
  }

  _normError(res, context) {
    return async () => {
      const raw = await readErrorText(res);
      let msg = raw;
      try {
        const j = JSON.parse(raw);
        msg = j?.error?.message || raw;
        const code = j?.error?.code || j?.error?.type || '';
        if (/invalid_api_key|incorrect_api_key|invalid_authorization/i.test(msg + code)) {
          return { type: ErrorTypes.AUTHENTICATION_FAILED, message: 'OpenAI key rejected.', code: res.status, retryable: false };
        }
        if (/rate_limit_exceeded/i.test(msg + code)) {
          return { type: ErrorTypes.RATE_LIMITED, message: msg.slice(0, 200), code: res.status, retryable: true };
        }
        if (/insufficient_quota/i.test(msg + code)) {
          return { type: ErrorTypes.QUOTA_EXCEEDED, message: 'OpenAI quota/billing limit reached.', code: res.status, retryable: false };
        }
        if (/model_not_found|does not exist/i.test(msg + code)) {
          return { type: ErrorTypes.MODEL_UNAVAILABLE, message: msg.slice(0, 200), code: res.status, retryable: false };
        }
        if (/context_length_exceeded/i.test(msg + code)) {
          return { type: ErrorTypes.INVALID_REQUEST, message: 'Context length exceeded.', code: res.status, retryable: false };
        }
      } catch { /* fall through */ }
      return this.normalizeError({ message: `OpenAI ${context} ${res.status}: ${msg.slice(0, 200)}`, statusCode: res.status });
    };
  }

  async execute(userId, credentialId, request) {
    const key = credOf(this, userId);
    const { model, messages, system, maxTokens = 1200 } = request;
    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(this._body(model, messages, system, false, maxTokens)),
        signal: timeoutSignal(TIMEOUT_EXEC, request.signal),
      });
    } catch (e) {
      throw this.normalizeError(e);
    }
    if (!res.ok) throw await this._normError(res, 'execute')();
    const data = await res.json();
    return this.normalizeResponse({
      text: data?.choices?.[0]?.message?.content || '',
      model: data?.model || model,
      usage: {
        promptTokens: data?.usage?.prompt_tokens || 0,
        completionTokens: data?.usage?.completion_tokens || 0,
        totalTokens: data?.usage?.total_tokens || 0,
      },
      metadata: { provider: 'openai' },
    });
  }

  async stream(userId, credentialId, request, onToken) {
    const key = credOf(this, userId);
    const { model, messages, system, maxTokens = 1200 } = request;
    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(this._body(model, messages, system, true, maxTokens)),
        signal: timeoutSignal(TIMEOUT_EXEC, request.signal),
      });
    } catch (e) {
      throw this.normalizeError(e);
    }
    if (!res.ok) throw await this._normError(res, 'stream')();
    let full = '';
    await readSSEStream(res, {
      onEvent: (_ev, json) => {
        const delta = json?.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onToken(full);
        }
      },
    }, request.signal);
    return this.normalizeResponse({ text: full, model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, metadata: { provider: 'openai', usageEstimated: true } });
  }

  async healthCheck(userId) {
    const start = Date.now();
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    if (!key) return { status: 'auth_failed', latency: Date.now() - start };
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key.credential}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401) return { status: 'auth_failed', latency: Date.now() - start };
      if (res.status === 429) return { status: 'rate_limited', latency: Date.now() - start };
      if (!res.ok) return { status: 'unavailable', latency: Date.now() - start };
      return { status: 'healthy', latency: Date.now() - start };
    } catch (e) {
      return { status: 'unavailable', latency: Date.now() - start, error: String(e.message || e).slice(0, 120) };
    }
  }
}

// ---------------- Anthropic ----------------

const ANTHROPIC_MODELS = [
  { modelId: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', capabilities: { text: true, vision: true, reasoning: true, functionCalling: true, streaming: true }, contextLimit: 200000, modalities: ['text', 'image'] },
  { modelId: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku', capabilities: { text: true, vision: true, functionCalling: true, streaming: true }, contextLimit: 200000, modalities: ['text', 'image'] },
  { modelId: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', capabilities: { text: true, vision: true, reasoning: true, functionCalling: true, streaming: true }, contextLimit: 200000, modalities: ['text', 'image'] },
];

const ANTHROPIC_VERSION = '2023-06-01';

/** Anthropic takes system separately; messages must be user/assistant only. */
export function anthropicPayload(model, messages, system, stream, maxTokens) {
  let sys = system || '';
  const turns = [];
  for (const m of messages || []) {
    if (m.role === 'system') {
      sys = sys ? `${sys}\n\n${m.content}` : m.content;
      continue;
    }
    turns.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') });
  }
  // merge consecutive same-role turns (API 400s otherwise)
  const merged = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else merged.push({ ...t });
  }
  return { model, max_tokens: maxTokens, stream, ...(sys ? { system: sys } : {}), messages: merged };
}

export class AnthropicAdapter extends ProviderAdapter {
  constructor(vault = credentialVault) {
    super('anthropic', vault);
    this.baseUrl = 'https://api.anthropic.com/v1';
  }

  async validateCredential(credential) {
    if (typeof credential !== 'string' || !credential.startsWith('sk-ant-') || credential.length < 20) {
      return { valid: false, error: 'Invalid Anthropic key format (starts with sk-ant-).' };
    }
    return { valid: true };
  }

  _headers(key) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  async authenticate(userId) {
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    if (!key) return { valid: false, error: 'Credential not found' };
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'x-api-key': key.credential, 'anthropic-version': ANTHROPIC_VERSION },
        signal: AbortSignal.timeout(TIMEOUT_FAST),
      });
      if (res.status === 401) return { valid: false, error: 'Key rejected by Anthropic (401).' };
      if (!res.ok) return { valid: false, error: `Anthropic check failed (${res.status}).` };
      return { valid: true };
    } catch (e) {
      return { valid: false, error: `Unreachable: ${String(e.message || e).slice(0, 120)}` };
    }
  }

  async listModels(userId) {
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    try {
      if (!key) throw new Error('no-credential');
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'x-api-key': key.credential, 'anthropic-version': ANTHROPIC_VERSION },
        signal: AbortSignal.timeout(TIMEOUT_FAST),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const items = (data && data.data) || [];
      if (!items.length) throw new Error('empty list');
      return items.slice(0, 60).map((m) => ({
        modelId: m.id, displayName: m.display_name || m.id,
        capabilities: { text: true, vision: true, functionCalling: true, streaming: true },
        contextLimit: null, streaming: true, async: false, availability: 'public', live: true,
      }));
    } catch {
      return ANTHROPIC_MODELS.map((m) => ({ ...m, streaming: true, async: false, availability: 'public', live: false }));
    }
  }

  _normAnthropicError(res, context) {
    return async () => {
      const raw = await readErrorText(res);
      let msg = raw;
      let type = '';
      try {
        const j = JSON.parse(raw);
        msg = j?.error?.message || raw;
        type = j?.error?.type || '';
      } catch { /* keep raw */ }
      if (res.status === 401 || /invalid x-api-key|authentication/i.test(msg + type)) {
        return { type: ErrorTypes.AUTHENTICATION_FAILED, message: 'Anthropic key rejected.', code: res.status, retryable: false };
      }
      if (res.status === 429 || /rate_limit/i.test(type)) {
        return { type: ErrorTypes.RATE_LIMITED, message: msg.slice(0, 200), code: res.status, retryable: true };
      }
      if (/not_found/i.test(type)) {
        return { type: ErrorTypes.MODEL_UNAVAILABLE, message: msg.slice(0, 200), code: res.status, retryable: false };
      }
      if (/overloaded/i.test(type) || res.status === 529) {
        return { type: ErrorTypes.UNAVAILABLE, message: 'Anthropic overloaded, retry shortly.', code: res.status, retryable: true };
      }
      return this.normalizeError({ message: `Anthropic ${context} ${res.status}: ${msg.slice(0, 200)}`, statusCode: res.status });
    };
  }

  async execute(userId, credentialId, request) {
    const key = credOf(this, userId);
    const { model, messages, system, maxTokens = 1200 } = request;
    let res;
    try {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this._headers(key),
        body: JSON.stringify(anthropicPayload(model, messages, system, false, maxTokens)),
        signal: timeoutSignal(TIMEOUT_EXEC, request.signal),
      });
    } catch (e) {
      throw this.normalizeError(e);
    }
    if (!res.ok) throw await this._normAnthropicError(res, 'execute')();
    const data = await res.json();
    const text = ((data && data.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return this.normalizeResponse({
      text,
      model: (data && data.model) || model,
      usage: {
        promptTokens: (data && data.usage && data.usage.input_tokens) || 0,
        completionTokens: (data && data.usage && data.usage.output_tokens) || 0,
        totalTokens: ((data && data.usage && data.usage.input_tokens) || 0) + ((data && data.usage && data.usage.output_tokens) || 0),
      },
      metadata: { provider: 'anthropic' },
    });
  }

  async stream(userId, credentialId, request, onToken) {
    const key = credOf(this, userId);
    const { model, messages, system, maxTokens = 1200 } = request;
    let res;
    try {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this._headers(key),
        body: JSON.stringify(anthropicPayload(model, messages, system, true, maxTokens)),
        signal: timeoutSignal(TIMEOUT_EXEC, request.signal),
      });
    } catch (e) {
      throw this.normalizeError(e);
    }
    if (!res.ok) throw await this._normAnthropicError(res, 'stream')();
    let full = '';
    await readSSEStream(res, {
      onEvent: (ev, json) => {
        if (ev === 'content_block_delta' && json?.delta?.type === 'text_delta' && json.delta.text) {
          full += json.delta.text;
          onToken(full);
        } else if (ev === 'error') {
          throw new Error(json?.error?.message || 'Anthropic stream error.');
        }
      },
    }, request.signal);
    return this.normalizeResponse({ text: full, model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, metadata: { provider: 'anthropic', usageEstimated: true } });
  }

  async healthCheck(userId) {
    const start = Date.now();
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    if (!key) return { status: 'auth_failed', latency: Date.now() - start };
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'x-api-key': key.credential, 'anthropic-version': ANTHROPIC_VERSION },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401) return { status: 'auth_failed', latency: Date.now() - start };
      if (res.status === 429) return { status: 'rate_limited', latency: Date.now() - start };
      if (!res.ok) return { status: 'unavailable', latency: Date.now() - start };
      return { status: 'healthy', latency: Date.now() - start };
    } catch (e) {
      return { status: 'unavailable', latency: Date.now() - start, error: String(e.message || e).slice(0, 120) };
    }
  }
}

// ---------------- Google Gemini ----------------

const GEMINI_MODELS = [
  { modelId: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', capabilities: { text: true, vision: true, functionCalling: true, streaming: true }, contextLimit: 1048576, modalities: ['text', 'image'] },
  { modelId: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', capabilities: { text: true, vision: true, reasoning: true, functionCalling: true, streaming: true }, contextLimit: 2097152, modalities: ['text', 'image'] },
];

/** OpenAI-style turns → Gemini contents (assistant→model; system folded in). */
export function geminiContents(messages, system) {
  const contents = [];
  const sys = [system, ...((messages || []).filter((m) => m.role === 'system').map((m) => m.content))].filter(Boolean).join('\n\n');
  for (const m of messages || []) {
    if (m.role === 'system') continue;
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] });
  }
  return {
    ...(sys ? { system_instruction: { parts: [{ text: sys }] } } : {}),
    contents,
  };
}

export class GeminiAdapter extends ProviderAdapter {
  constructor(vault = credentialVault) {
    super('gemini', vault);
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  async validateCredential(credential) {
    if (typeof credential !== 'string' || !credential.startsWith('AIza') || credential.length < 20) {
      return { valid: false, error: 'Invalid Gemini key format (starts with AIza).' };
    }
    return { valid: true };
  }

  async authenticate(userId) {
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    if (!key) return { valid: false, error: 'Credential not found' };
    try {
      const res = await fetch(`${this.baseUrl}/models?key=${encodeURIComponent(key.credential)}`, {
        signal: AbortSignal.timeout(TIMEOUT_FAST),
      });
      if (res.status === 400) {
        const t = await readErrorText(res);
        if (/API_KEY_INVALID/i.test(t)) return { valid: false, error: 'Key rejected by Google (invalid).' };
      }
      if (!res.ok) return { valid: false, error: `Google check failed (${res.status}).` };
      return { valid: true };
    } catch (e) {
      return { valid: false, error: `Unreachable: ${String(e.message || e).slice(0, 120)}` };
    }
  }

  async listModels(userId) {
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    try {
      if (!key) throw new Error('no-credential');
      const res = await fetch(`${this.baseUrl}/models?key=${encodeURIComponent(key.credential)}`, {
        signal: AbortSignal.timeout(TIMEOUT_FAST),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const items = ((data && data.models) || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'));
      if (!items.length) throw new Error('empty list');
      return items.slice(0, 60).map((m) => ({
        modelId: String(m.name || '').replace(/^models\//, ''),
        displayName: m.displayName || m.name,
        capabilities: { text: true, streaming: true },
        contextLimit: m.inputTokenLimit || null,
        streaming: true, async: false, availability: 'public', live: true,
      }));
    } catch {
      return GEMINI_MODELS.map((m) => ({ ...m, streaming: true, async: false, availability: 'public', live: false }));
    }
  }

  _normGeminiError(res, context) {
    return async () => {
      const raw = await readErrorText(res);
      let msg = raw;
      try {
        const j = JSON.parse(raw);
        msg = j?.error?.message || raw;
      } catch { /* keep raw */ }
      if (/API_KEY_INVALID/i.test(msg)) {
        return { type: ErrorTypes.AUTHENTICATION_FAILED, message: 'Gemini key rejected.', code: res.status, retryable: false };
      }
      if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        return { type: ErrorTypes.RATE_LIMITED, message: msg.slice(0, 200), code: res.status, retryable: true };
      }
      if (res.status === 404 || /not found/i.test(msg)) {
        return { type: ErrorTypes.MODEL_UNAVAILABLE, message: msg.slice(0, 200), code: res.status, retryable: false };
      }
      return this.normalizeError({ message: `Gemini ${context} ${res.status}: ${msg.slice(0, 200)}`, statusCode: res.status });
    };
  }

  _textOf(data) {
    const cands = (data && data.candidates) || [];
    const parts = [];
    for (const c of cands) {
      for (const p of ((c && c.content && c.content.parts) || [])) {
        if (typeof p.text === 'string') parts.push(p.text);
      }
    }
    return parts.join('');
  }

  async execute(userId, credentialId, request) {
    const key = credOf(this, userId);
    const { model, messages, system, maxTokens = 1200 } = request;
    const body = { ...geminiContents(messages, system), generationConfig: { maxOutputTokens: maxTokens } };
    let res;
    try {
      res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: timeoutSignal(TIMEOUT_EXEC, request.signal),
      });
    } catch (e) {
      throw this.normalizeError(e);
    }
    if (!res.ok) throw await this._normGeminiError(res, 'execute')();
    const data = await res.json();
    const um = (data && data.usageMetadata) || {};
    return this.normalizeResponse({
      text: this._textOf(data),
      model,
      usage: {
        promptTokens: um.promptTokenCount || 0,
        completionTokens: um.candidatesTokenCount || 0,
        totalTokens: um.totalTokenCount || 0,
      },
      metadata: { provider: 'gemini' },
    });
  }

  async stream(userId, credentialId, request, onToken) {
    const key = credOf(this, userId);
    const { model, messages, system, maxTokens = 1200 } = request;
    const body = { ...geminiContents(messages, system), generationConfig: { maxOutputTokens: maxTokens } };
    let res;
    try {
      res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: timeoutSignal(TIMEOUT_EXEC, request.signal),
      });
    } catch (e) {
      throw this.normalizeError(e);
    }
    if (!res.ok) throw await this._normGeminiError(res, 'stream')();
    let full = '';
    await readSSEStream(res, {
      onEvent: (_ev, json) => {
        const t = this._textOf(json);
        if (t) {
          full += t;
          onToken(full);
        }
      },
    }, request.signal);
    return this.normalizeResponse({ text: full, model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, metadata: { provider: 'gemini', usageEstimated: true } });
  }

  async healthCheck(userId) {
    const start = Date.now();
    const key = this.credentialVault.getUserCredential(userId, this.providerId);
    if (!key) return { status: 'auth_failed', latency: Date.now() - start };
    try {
      const res = await fetch(`${this.baseUrl}/models?key=${encodeURIComponent(key.credential)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 400) {
        const t = await readErrorText(res);
        if (/API_KEY_INVALID/i.test(t)) return { status: 'auth_failed', latency: Date.now() - start };
      }
      if (res.status === 429) return { status: 'rate_limited', latency: Date.now() - start };
      if (!res.ok) return { status: 'unavailable', latency: Date.now() - start };
      return { status: 'healthy', latency: Date.now() - start };
    } catch (e) {
      return { status: 'unavailable', latency: Date.now() - start, error: String(e.message || e).slice(0, 120) };
    }
  }
}

// ---------------- factory ----------------

import { OpenRouterAdapter, NvidiaAdapter } from './providerAdapter.js';

const CLASSES = {
  openai: OpenAIAdapter,
  anthropic: AnthropicAdapter,
  gemini: GeminiAdapter,
  openrouter: OpenRouterAdapter,
  nvidia: NvidiaAdapter,
};

export function supportedProviders() {
  return Object.keys(CLASSES);
}

/** Adapter instance bound to the (server-side) credential vault facade. */
export function getAdapter(providerId) {
  const Cls = CLASSES[providerId];
  if (!Cls) return null;
  return new Cls(credentialVault);
}
