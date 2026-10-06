// The home composition: presence is derived from real state, and signals only
// appear when there is something real to say.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import App from './App';
import { StoreProviders } from './store';
import { AuthProvider } from './lib/auth';
import { TaskCheckpointManager } from './lib/agent/checkpoint';

const health = {
  ok: true, server: true, ai: false, voice: false, vision: false, realaltime: false, realtime: false,
  database: false, provider: null, degraded: false, models: { free: 0, total: 0, catalogue: false },
};

function stubNetwork() {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify(health), { headers: { 'Content-Type': 'application/json' } }));
    }
    if (u.includes('/api/config')) {
      return Promise.resolve(new Response(JSON.stringify({ supabaseUrl: null, supabaseAnonKey: null }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({ missions: [] }), { headers: { 'Content-Type': 'application/json' } }));
  }));
}

function mount() {
  return render(
    <AuthProvider>
      <StoreProviders>
        <App />
      </StoreProviders>
    </AuthProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/?no-intro');
  stubNetwork();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  TaskCheckpointManager['inMemoryStore'].clear();
});

describe('MetaIoid home', () => {
  it('states its presence before the user asks anything', async () => {
    mount();
    await waitFor(() => expect(screen.getByText(/MetaIoid · Live/i)).toBeTruthy(), { timeout: 4000 });
    // The resting state is honest: ready, not busy.
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('greets by the clock and still offers the four entrances', async () => {
    mount();
    await waitFor(() => expect(screen.getByText(/Good (morning|afternoon|evening)|Still up/)).toBeTruthy(), { timeout: 4000 });
    for (const label of ['Ask', 'Research', 'Build', 'Analyze']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('says nothing proactive when there is nothing to say', async () => {
    mount();
    await waitFor(() => expect(screen.getByText(/MetaIoid · Live/i)).toBeTruthy(), { timeout: 4000 });
    expect(screen.queryByText('Pick up where you left off')).toBeNull();
    expect(screen.queryByText('Active mission')).toBeNull();
  });

  it('picks up unfinished work and names the step that stopped', async () => {
    TaskCheckpointManager.saveCheckpoint({
      taskId: 'task_test_1',
      objective: 'Fix the login screen',
      status: 'RECOVERING',
      currentStepIndex: 0,
      steps: [
        { id: 'a', type: 'UNDERSTAND', label: 'Understand the request', detail: '', status: 'completed', retries: 0 },
        { id: 'b', type: 'CODE_EDIT', label: 'Apply the fix', detail: '', status: 'pending', retries: 0 },
      ],
      artifacts: [],
      context: { origin: 'chat' },
      telemetry: { resumedCount: 1, errorCount: 0, lastHeartbeat: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    mount();
    await waitFor(() => expect(screen.getByText('Pick up where you left off')).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByText(/Apply the fix/)).toBeTruthy();
  });

  it('uses the signature phrase only for a diagnosed failure', async () => {
    TaskCheckpointManager.saveCheckpoint({
      taskId: 'task_test_2',
      objective: 'Build the release bundle',
      status: 'RECOVERING',
      currentStepIndex: 0,
      steps: [
        { id: 'a', type: 'TEST_EXECUTION', label: 'Run the tests', detail: '', status: 'failed', error: 'two assertions failed', retries: 1 },
      ],
      artifacts: [],
      context: { origin: 'chat' },
      telemetry: { resumedCount: 1, errorCount: 1, lastHeartbeat: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    mount();
    await waitFor(() => expect(screen.getByText('MetaIoid noticed…')).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByText(/two assertions failed/)).toBeTruthy();
  });
});

describe('the loop that makes presence real', () => {
  it('holds work the user stops, and offers to continue it later', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('Message MetaIoid')).toBeTruthy(), { timeout: 4000 });

    const composer = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Build a presentation about renewable energy' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', shiftKey: false });

    // Let the first stage land, then stop. The work is genuinely unfinished.
    await waitFor(() => expect(screen.getByLabelText('Stop generating')).toBeTruthy(), { timeout: 4000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    fireEvent.click(screen.getByLabelText('Stop generating'));

    await waitFor(() => expect(screen.queryByLabelText('Stop generating')).toBeNull(), { timeout: 4000 });

    // The turn itself says it is held rather than sitting there empty.
    await waitFor(() => expect(screen.getByText('Held — continue whenever you are ready')).toBeTruthy(), { timeout: 4000 });

    // Back to an empty conversation: the home composition must pick the thread
    // back up and name the step it stopped on.
    const newChat = await waitFor(() => {
      const els = screen.getAllByText('New chat');
      const btn = els.find((e) => e.closest('button'));
      if (!btn) throw new Error('new chat not found');
      return btn.closest('button') as HTMLElement;
    }, { timeout: 4000 });
    fireEvent.click(newChat);

    await waitFor(() => expect(screen.getByText('Pick up where you left off')).toBeTruthy(), { timeout: 6000 });
    expect(screen.getByText(/renewable energy/i)).toBeTruthy();
  }, 20000);
});

describe('unfinished work in the workspace', () => {
  it('is listed under Tasks without needing a gateway', async () => {
    TaskCheckpointManager.saveCheckpoint({
      taskId: 'task_local_1',
      objective: 'Quarterly investor update',
      status: 'PAUSED',
      currentStepIndex: 1,
      steps: [
        { id: 'a', type: 'UNDERSTAND', label: 'Gather the numbers', detail: '', status: 'completed', retries: 0 },
        { id: 'b', type: 'DOCUMENT_GENERATION', label: 'Write the summary', detail: '', status: 'pending', retries: 0 },
      ],
      artifacts: [],
      context: { origin: 'chat' },
      telemetry: { resumedCount: 0, errorCount: 0, lastHeartbeat: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    mount();
    await waitFor(() => expect(screen.getByLabelText('Message MetaIoid')).toBeTruthy(), { timeout: 4000 });

    const tasks = await waitFor(() => {
      const els = screen.getAllByText('Tasks');
      const btn = els.find((e) => e.closest('button'));
      if (!btn) throw new Error('tasks nav not found');
      return btn.closest('button') as HTMLElement;
    }, { timeout: 4000 });
    fireEvent.click(tasks);

    await waitFor(() => expect(screen.getByText('Unfinished on this device · 1')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('Quarterly investor update')).toBeTruthy();
    expect(screen.getByText(/Next: Write the summary/)).toBeTruthy();
  });
});
