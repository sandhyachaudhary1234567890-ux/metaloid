// End-to-end-ish render tests: the real store, the real screens, stubbed
// network. This is the guard against "it compiles but the app is blank".

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import App from './App';
import { StoreProviders } from './store';
import { AuthProvider } from './lib/auth';

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

// Mirrors main.tsx: the real app always has the auth provider above the
// stores, so the tests mount the same tree.
function mount() {
  return render(
    <AuthProvider>
      <StoreProviders>
        <App />
      </StoreProviders>
    </AuthProvider>
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
  it('lands on chat with the brand visible and four destinations', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByRole('img', { name: /MetaIoid/i }).length).toBeGreaterThan(0));
    for (const label of ['Chat', 'History', 'Research', 'Settings']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // the one-second test: the place to type and the way to speak are both here
    expect(await screen.findByLabelText('Message MetaIoid')).toBeTruthy();
    expect(screen.getAllByLabelText('Talk to MetaIoid').length).toBeGreaterThan(0);
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
    // the conversation names itself from the first thing you said
    expect(screen.getAllByText('Hello there').length).toBeGreaterThan(0);
  });
});

describe('every screen renders without crashing', () => {
  const open = async (label: string) => {
    mount();
    const btn = await waitFor(() => {
      const els = screen.getAllByText(label);
      const el = els.find((e) => e.closest('button'));
      if (!el) throw new Error(`${label} nav not found`);
      return el.closest('button') as HTMLElement;
    });
    fireEvent.click(btn);
  };

  it('Memory vault is reachable from Settings', async () => {
    await open('Settings');
    const vault = await waitFor(() => screen.getByText('Open Memory Vault'), { timeout: 4000 });
    fireEvent.click(vault);
    await waitFor(() => expect(document.body.textContent).toMatch(/memory/i), { timeout: 4000 });
  });

  it('History', async () => {
    await open('History');
    await waitFor(() => expect(document.body.textContent).toMatch(/history|no conversations|conversation/i), { timeout: 4000 });
  });

  it('Settings renders and exposes the gateway URL control', async () => {
    await open('Settings');
    await waitFor(() => expect(screen.getByLabelText('Backend URL')).toBeTruthy(), { timeout: 4000 });
  });

  it('Live degrades gracefully with no camera available (jsdom has none)', async () => {
    mount();
    // Live is contextual now: it lives behind the composer's + sheet
    fireEvent.click(await waitFor(() => screen.getAllByLabelText('More ways to send')[0], { timeout: 4000 }));
    fireEvent.click(await waitFor(() => screen.getByText('Show the camera'), { timeout: 4000 }));
    // the screen must survive a missing getUserMedia instead of throwing
    await waitFor(() => expect(document.body.textContent).toMatch(/live|camera|vision/i), { timeout: 4000 });
  });
});
