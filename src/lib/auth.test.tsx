// Auth layer: session handling, error translation, and the promise that an
// unconfigured build never pretends to have accounts.
//
// The Supabase seam (src/lib/supabase.ts) is mocked rather than the network,
// because what is being tested is OUR logic: state transitions, error
// translation and the configured/unconfigured decision.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const listeners: ((event: string, session: unknown) => void)[] = [];
let sessionValue: unknown = null;
let configured = true;

const auth = {
  getSession: vi.fn(async () => ({ data: { session: sessionValue } })),
  onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
    listeners.push(cb);
    return { data: { subscription: { unsubscribe: () => {} } } };
  }),
  signInWithPassword: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(async () => ({ data: { session: null, user: { id: 'u1' } }, error: null })),
  signOut: vi.fn(async () => ({ error: null })),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
  updateUser: vi.fn(async () => ({ error: null })),
  resend: vi.fn(async () => ({ error: null })),
};

vi.mock('./supabase', () => ({
  supabaseConfigured: () => configured,
  supabaseUrl: () => (configured ? 'https://project.supabase.co' : ''),
  getSupabase: async () => (configured ? { auth } : null),
  getSession: async () => (configured ? sessionValue : null),
  getAccessToken: async () => (configured ? (sessionValue as { access_token?: string } | null)?.access_token ?? null : null),
  authRuntime: () => ({ configured, url: configured ? 'https://project.supabase.co' : null }),
}));

type AuthModule = typeof import('./auth');
async function loadAuth() {
  vi.resetModules();
  return import('./auth');
}

beforeEach(() => {
  cleanup();
  listeners.length = 0;
  sessionValue = null;
  configured = true;
  Object.values(auth).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as { mockClear: () => void }).mockClear();
  });
  auth.getSession.mockImplementation(async () => ({ data: { session: sessionValue } }));
  auth.signInWithPassword.mockResolvedValue({ error: null } as never);
  auth.signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null } as never);
});

describe('unconfigured build', () => {
  it('reports unconfigured, so the app never shows a login nobody can pass', async () => {
    configured = false;
    const { AuthProvider, useAuth } = await loadAuth();
    function Probe() {
      const a = useAuth();
      return <span data-testid="mode">{String(a.configured)}:{a.status}</span>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('false:unconfigured'));
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});

describe('configured build', () => {
  it('restores a persisted session on load', async () => {
    sessionValue = { access_token: 'jwt-abc', user: { id: 'u1', email: 'person@example.com' } };
    const { AuthProvider, useAuth } = await loadAuth();
    function Probe() {
      const a = useAuth();
      return <span data-testid="who">{a.status}:{a.user?.email ?? 'none'}:{a.accessToken ?? 'no-token'}</span>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('signed-in:person@example.com:jwt-abc'));
  });

  it('starts signed-out with no session, and follows auth state changes', async () => {
    const { AuthProvider, useAuth } = await loadAuth();
    function Probe() {
      const a = useAuth();
      return (
        <>
          <span data-testid="status">{a.status}</span>
          <button onClick={() => a.signIn('person@example.com', 'hunter2hunter2')}>go</button>
        </>
      );
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));

    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'person@example.com', password: 'hunter2hunter2',
    }));

    listeners.forEach((cb) => cb('SIGNED_IN', { access_token: 'jwt-new', user: { id: 'u1', email: 'person@example.com' } }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'));
  });

  it('turns provider errors into sentences a person can act on', async () => {
    const { AuthProvider, useAuth } = await loadAuth();
    let result: { ok: boolean; message?: string; code?: string } | null = null;
    function Probe() {
      const a = useAuth();
      return <button onClick={async () => { result = await a.signIn('x@y.z', 'nope'); }}>go</button>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);

    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } } as never);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(result).not.toBeNull());
    expect(result!.ok).toBe(false);
    expect(result!.code).toBe('bad_credentials');
    expect(result!.message).toBe('That email and password combination is not recognised.');
    expect(result!.message).not.toMatch(/invalid login credentials/i);

    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } } as never);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(result!.code).toBe('email_unconfirmed'));

    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email rate limit exceeded' } } as never);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(result!.code).toBe('rate_limited'));
  });

  it('tells a new user to confirm their email instead of doing nothing', async () => {
    const { AuthProvider, useAuth } = await loadAuth();
    let result: { ok: boolean; needsVerification?: boolean; message?: string } | null = null;
    function Probe() {
      const a = useAuth();
      return <button onClick={async () => { result = await a.signUp('new@example.com', 'password123', 'New'); }}>go</button>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(result).not.toBeNull());
    expect(result!.ok).toBe(true);
    expect(result!.needsVerification).toBe(true);
    expect(result!.message).toMatch(/confirm your email/i);
  });

  it('signs out and clears the session', async () => {
    sessionValue = { access_token: 'jwt', user: { id: 'u1', email: 'person@example.com' } };
    const { AuthProvider, useAuth } = await loadAuth();
    function Probe() {
      const a = useAuth();
      return (
        <>
          <span data-testid="status">{a.status}</span>
          <button onClick={() => a.signOut()}>out</button>
        </>
      );
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'));
    fireEvent.click(screen.getByText('out'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());

    listeners.forEach((cb) => cb('SIGNED_OUT', null));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
  });

  it('enters recovery mode when a password-reset link is opened', async () => {
    const { AuthProvider, useAuth } = await loadAuth();
    function Probe() {
      const a = useAuth();
      return <span data-testid="recovery">{String(a.recoveryMode)}</span>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    listeners.forEach((cb) => cb('PASSWORD_RECOVERY', sessionValue));
    await waitFor(() => expect(screen.getByTestId('recovery').textContent).toBe('true'));
  });
});
