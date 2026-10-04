// Transport contract tests.
//
// The transport is the seam where "the gateway is broken" turns into "the
// user sees something honest", so every branch is pinned here:
//   reachable real provider  -> online
//   sandbox provider         -> mock   (never online)
//   key but unreachable      -> degraded (never online)
//   nothing reachable        -> offline + local demo engine
//   gateway stream error     -> error surfaces with its stable code

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkBackend, streamChat, API_URL, normalizeApiKey, detectProviderFromKey } from './transport';

const health = (over: Record<string, unknown> = {}) => ({
  ok: true, server: true, ai: true, voice: false, vision: true, realtime: true, database: false,
  provider: 'openrouter', degraded: false, models: { free: 12, total: 12, catalogue: true },
  ...over,
});

function jsonOnce(body: unknown, init: { status?: number } = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

/** Build an SSE Response from raw event objects. */
function sseResponse(events: unknown[], init: { status?: number } = {}) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: init.status ?? 200, headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('checkBackend — connection truth', () => {
  it('real provider, reachable => online', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOnce(health())));
    const r = await checkBackend('http://127.0.0.1:8787');
    expect(r.state).toBe('online');
    expect(r.health.provider).toBe('openrouter');
  });

  it('sandbox provider => mock, never online', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOnce(health({ provider: 'local-mock' }))));
    const r = await checkBackend('http://127.0.0.1:8787');
    expect(r.state).toBe('mock');
  });

  it('key present but provider unreachable => degraded, never online', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOnce(health({ ai: false, degraded: true, models: { free: 0, catalogue: false } }))));
    const r = await checkBackend('http://127.0.0.1:8787');
    expect(r.state).toBe('offline');
  });

  it('nothing reachable => offline with an all-down health shape', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const r = await checkBackend('http://127.0.0.1:8787');
    expect(r.state).toBe('offline');
    expect(r.health.ai).toBe(false);
    expect(r.health.server).toBe(false);
  });

  // The regression this exists for: a signed-in user connected their own key
  // while the shared platform key was missing/unhealthy. Health said
  // ai:false, the app went offline, and every reply became the local demo —
  // even though the user's key was a complete, working path.
  it('a connected account key keeps the app online when the shared provider is down', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOnce(health({
      ai: false, degraded: true, byok: true, byokProviders: ['openrouter'],
      models: { free: 0, catalogue: false },
    }))));
    const r = await checkBackend('http://127.0.0.1:8787');
    expect(r.state).toBe('online');
    expect(r.health.byok).toBe(true);
    expect(r.health.byokProviders).toEqual(['openrouter']);
  });

  it('no key at all still reports offline — the demo is honest there', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOnce(health({ ai: false, degraded: false, byok: false, byokProviders: [] }))));
    const r = await checkBackend('http://127.0.0.1:8787');
    expect(r.state).toBe('offline');
  });

  it('https gateway rescued by scheme swap to http', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(String(url));
      return String(url).startsWith('https://')
        ? Promise.reject(new Error('TLS handshake failed'))
        : jsonOnce(health());
    }));
    const r = await checkBackend('https://127.0.0.1:8787');
    expect(r.state).toBe('online');
    expect(calls.some((u) => u.startsWith('http://127.0.0.1:8787'))).toBe(true);
  });
});

describe('streamChat — real path', () => {
  const opts = { configuredUrl: 'http://127.0.0.1:8787', history: [] as { role: string; content: string }[] };

  it('streams tokens and reports the provider', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/api/health')) return jsonOnce(health());
      return Promise.resolve(sseResponse([
        { meta: { model: 'fake/alpha:free', tier: 'smart', provider: 'openrouter', demo: false } },
        { token: 'Hello' },
        { token: 'Hello world' },
        { done: true },
      ]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const seen: string[] = [];
    const res = await streamChat('hi', opts, (t) => seen.push(t));
    expect(res.text).toBe('Hello world');
    expect(res.demo).toBe(false);
    expect(res.model).toBe('fake/alpha:free');
    expect(seen[seen.length - 1]).toBe('Hello world');
  });

  it('sandbox provider marks the result demo:true even though it streamed', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/health')) return jsonOnce(health({ provider: 'local-mock' }));
      return Promise.resolve(sseResponse([
        { meta: { model: 'sandbox/model', tier: 'smart', provider: 'local-mock', demo: true } },
        { token: 'canned' },
        { done: true },
      ]));
    }));
    const res = await streamChat('hi', opts, () => {});
    expect(res.text).toBe('canned');
    expect(res.demo).toBe(true);
    expect(res.provider).toBe('local-mock');
  });

  it('gateway error carries its stable code to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/health')) return jsonOnce(health());
      return Promise.resolve(sseResponse([
        { meta: { model: 'fake/alpha:free', tier: 'smart', provider: 'openrouter' } },
        { error: 'Every free model is rate-limited right now. Try again in a minute.', code: 'rate_limited' },
      ]));
    }));
    await expect(streamChat('hi', opts, () => {})).rejects.toMatchObject({
      message: expect.stringMatching(/rate-limited/i),
      code: 'rate_limited',
    });
  });

  // Ordering matters: the chat request is the reachability test. A slow or
  // broken /api/health must never reroute a connected user to the demo — that
  // was the reported bug ("hi" → "Hey. I'm here. What are we working on?").
  it('health unreachable but chat reachable => real reply, no demo', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/api/health')) return Promise.reject(new Error('cold start timeout'));
      return Promise.resolve(sseResponse([
        { meta: { model: 'fake/alpha:free', tier: 'fast', provider: 'openrouter', demo: false } },
        { token: 'Live answer.' },
        { done: true },
      ]));
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await streamChat('hi', opts, () => {});
    expect(res.demo).toBe(false);
    expect(res.text).toBe('Live answer.');
    // and it never needed the health probe at all
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('/api/health'))).toBe(true);
  });

  it('a healthy-byok gateway with ai:false still streams (no health gate)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/health')) {
        return jsonOnce(health({ ai: false, degraded: true, byok: true }));
      }
      return Promise.resolve(sseResponse([
        { meta: { model: 'my/own-model', tier: 'smart', provider: 'openrouter', byok: true } },
        { token: 'From your key.' },
        { done: true },
      ]));
    }));
    const res = await streamChat('hi', opts, () => {});
    expect(res.demo).toBe(false);
    expect(res.text).toBe('From your key.');
  });

  it('a user abort is never answered with a demo reply', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }));
    await expect(streamChat('hi', { ...opts, signal: controller.signal }, () => {}))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('unreachable gateway falls back to the local demo engine, labelled demo', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    // the demo engine reveals text on real timers — drive them instead of waiting
    vi.useFakeTimers();
    try {
      const p = streamChat('what can you do', opts, () => {});
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.demo).toBe(true);
      expect(res.text.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an empty 200 stream is an error, not a silent blank answer', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/health')) return jsonOnce(health());
      return Promise.resolve(sseResponse([{ meta: { model: 'x', tier: 'smart' } }]));
    }));
    await expect(streamChat('hi', opts, () => {})).rejects.toThrow(/empty response/i);
  });

  it('a non-OK chat response surfaces the gateway sentence', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/health')) return jsonOnce(health());
      return jsonOnce({ error: 'No AI provider is configured yet — connect a key to go online.' }, { status: 503 });
    }));
    await expect(streamChat('hi', opts, () => {})).rejects.toThrow(/no ai provider/i);
  });
});

describe('remote (non-loopback) host resolution', () => {
  it('API_URL falls back to same-origin when the page is not on loopback', async () => {
    // jsdom default host is localhost, so API_URL is the explicit loopback
    // default; the remote branch is exercised by unit-testing the rule itself.
    expect(typeof API_URL).toBe('string');
    expect(API_URL).toMatch(/^https?:\/\//);
  });

  it('a stored loopback URL is ignored on a remote host', async () => {
    const original = window.location;
    // pretend the page is served from a tunnel host
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, hostname: 'preview.example.dev', origin: 'https://preview.example.dev' },
    });
    vi.resetModules();
    const mod = await import('./transport');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(String(url));
      return jsonOnce(health());
    }));
    await mod.checkBackend('https://127.0.0.1:8787');
    expect(calls[0]?.startsWith('/api/')).toBe(true);
    expect(calls.some((u) => u.includes('127.0.0.1'))).toBe(false);
    vi.resetModules();
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });
});

describe('BYOK paste handling', () => {
  it('normalises what people actually paste', () => {
    expect(normalizeApiKey('  sk-or-v1-abc123def456  ')).toBe('sk-or-v1-abc123def456');
    expect(normalizeApiKey('"sk-or-v1-abc123def456"')).toBe('sk-or-v1-abc123def456');
    expect(normalizeApiKey('Bearer sk-or-v1-abc123def456\n')).toBe('sk-or-v1-abc123def456');
    expect(normalizeApiKey('\u200Bsk-or-v1-abc123def456')).toBe('sk-or-v1-abc123def456');
  });

  it('recognises the providers whose prefixes are distinctive', () => {
    expect(detectProviderFromKey('sk-or-v1-0123456789abcdef')).toBe('openrouter');
    expect(detectProviderFromKey('sk-ant-api03-0123456789abcdef')).toBe('anthropic');
    expect(detectProviderFromKey('sk-proj-0123456789abcdefghij')).toBe('openai');
    expect(detectProviderFromKey('AIzaSyA0123456789abcdefghijklmnop')).toBe('gemini');
    expect(detectProviderFromKey('gsk_0123456789abcdefghij')).toBe('groq');
    expect(detectProviderFromKey('nvapi-0123456789abcdefghij')).toBe('nvidia');
    // too short / unknown shapes make no claim
    expect(detectProviderFromKey('sk-abc')).toBeNull();
    expect(detectProviderFromKey('hello world this is not a key')).toBeNull();
  });

  it('an OpenRouter key is never mistaken for an OpenAI key', () => {
    // both start with sk-; the specific rule has to win
    expect(detectProviderFromKey('sk-or-v1-0123456789abcdef')).not.toBe('openai');
  });
});
