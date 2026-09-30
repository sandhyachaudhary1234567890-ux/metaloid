import { useState } from 'react';
import { useApp } from '../lib/store';
import { MetaloidCore } from './MetaloidCore';

// Sign-in gate: shown only when the gateway is reachable and no session
// exists. Offline demo stays usable without an account.
export function AuthScreen() {
  const { signup, login } = useApp();
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') await signup(handle.trim(), displayName.trim(), passcode);
      else await login(handle.trim(), passcode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center px-4 overflow-y-auto">
      <div className="w-full max-w-[400px] py-10 text-center">
        <div className="flex justify-center mb-5">
          <MetaloidCore size={92} status="idle" />
        </div>
        <h1 className="text-[24px] font-bold tracking-tight text-[var(--fg)]">This is your Metaloid.</h1>
        <p className="text-[13.5px] text-[var(--fg-muted)] mt-1.5">
          {mode === 'signup'
            ? 'Create your private instance — isolated memory, projects, and devices.'
            : 'Welcome back — your context is waiting.'}
        </p>

        <div className="mt-6 space-y-2.5 text-left">
          <label className="block">
            <span className="text-[12px] font-medium text-[var(--fg-muted)]">Handle</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
              placeholder="e.g. aayan"
              autoComplete="username"
              className="mt-1 h-11 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3.5 text-[14px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          {mode === 'signup' && (
            <label className="block">
              <span className="text-[12px] font-medium text-[var(--fg-muted)]">Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="What should Metaloid call you?"
                autoComplete="nickname"
                className="mt-1 h-11 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3.5 text-[14px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          )}
          <label className="block">
            <span className="text-[12px] font-medium text-[var(--fg-muted)]">Passcode</span>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="4+ characters"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="mt-1 h-11 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3.5 text-[14px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>

        {error && (
          <p className="mt-3 text-[13px] text-red-400" role="alert">
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={busy || handle.trim().length < 3 || passcode.length < 4}
          className="mt-4 h-11 w-full rounded-xl bg-[var(--accent)] text-white text-[14px] font-semibold disabled:opacity-50 hover:brightness-110"
        >
          {busy ? 'One moment…' : mode === 'signup' ? 'Create my Metaloid' : 'Sign in'}
        </button>

        <button
          onClick={() => {
            setMode(mode === 'signup' ? 'login' : 'signup');
            setError('');
          }}
          className="mt-3 text-[13px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
        >
          {mode === 'signup' ? 'Already have an instance? Sign in' : 'New here? Create your instance'}
        </button>

        <p className="mt-6 text-[11.5px] text-[var(--fg-faint)]">
          Your data stays on this gateway, isolated per account. No cross-user access — ever.
        </p>
      </div>
    </div>
  );
}
