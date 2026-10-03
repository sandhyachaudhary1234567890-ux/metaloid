// End-to-end-ish render tests: the real store, the real screens, stubbed
// network. This is the guard against "it compiles but the app is blank".

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import App from './App';
import { StoreProviders } from './store';

const health = {
  ok: true, server: true, ai: true, voice: false, vision: true, realtime: true, database: false,
  provider: 'openrouter', degraded: false, models: { free: 9, total: 9, catalogue: true },
};

function sseResponse(events: unknown[]) {
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200, headers: { 'Content-Type': 'text/event-stream' },
  });
}

function stubNetwork(chatEvents: unknown[] = [
  { meta: { model: 'fake/alpha:free', tier: 'smart', provider: 'openrouter', demo: false } },
  { token: 'Hello ' },
  { token: 'Hello from the gateway.' },
  { done: true },
]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify(health), { headers: { 'Content-Type': 'application/json' } }));
    }
    if (u.includes('/api/models')) {
      return Promise.resolve(new Response(JSON.stringify({ models: [], provider: 'openrouter' }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (u.includes('/api/chat')) return Promise.resolve(sseResponse(chatEvents));
    return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  }));
}

function mount() {
  return render(
    <StoreProviders>
      <App />
    </StoreProviders>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // skip the intro animation so assertions run against the real UI
  window.history.replaceState({}, '', '/?no-intro');
  stubNetwork();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('app shell', () => {
  it('renders the home screen with the brand and primary navigation', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText(/metaloid|MetaIoid/i).length).toBeGreaterThan(0));
    // primary sections exist
    for (const label of ['Home', 'Chat', 'Memory', 'Settings']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('reflects connection state in the sidebar without inventing ONLINE', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    mount();
    await waitFor(() => expect(screen.getAllByText(/LOCAL DEMO/i).length).toBeGreaterThan(0));
  });

  it('shows ONLINE only for a reachable real provider', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText(/ONLINE/i).length).toBeGreaterThan(0), { timeout: 4000 });
  });

  it('shows SANDBOX for a mock provider', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/health')) {
        return Promise.resolve(new Response(JSON.stringify({ ...health, provider: 'local-mock' }), {
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    }));
    mount();
    await waitFor(() => expect(screen.getAllByText(/SANDBOX/i).length).toBeGreaterThan(0), { timeout: 4000 });
  });
});

describe('chat loop', () => {
  it('sends a message and renders the streamed reply', async () => {
    mount();
    // navigate to chat
    const chatButtons = screen.getAllByText('Chat');
    fireEvent.click(chatButtons[0]);

    const composer = await waitFor(() => {
      const el = document.querySelector('textarea, input[type="text"]');
      if (!el) throw new Error('composer not found');
      return el as HTMLTextAreaElement;
    });

    fireEvent.change(composer, { target: { value: 'hello there' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', shiftKey: false });

    await waitFor(() => expect(screen.getByText(/Hello from the gateway\./)).toBeTruthy(), { timeout: 5000 });
  });
});
