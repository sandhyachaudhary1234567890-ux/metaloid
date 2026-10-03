import { useState } from 'react';
import { useApp } from '../lib/store';
import { MetaloidCore } from './MetaloidCore';
import { supabase, supabaseConfigured, saveSbSession } from '../lib/supabaseAuth';

// Sign-in gate: shown only when the gateway is reachable and no session
// exists. Offline demo stays usable without an account.
// Two paths: device passcode (local gateway account) or email (Supabase).
export function AuthScreen() {
  const { signup, login, loginWithSupabase } = useApp();
  const [tab, setTab] = useState<'passcode' | 'email'>(supabaseConfigured() ? 'email' : 'passcode');
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
          {tab === 'email'
            ? 'Sign in with email — your account roams across devices.'
            : mode === 'signup'
              ? 'Create your private instance — isolated memory, projects, and devices.'
              : 'Welcome back — your context is waiting.'}
        </p>

        {supabaseConfigured() && (
          <div className="mt-4 inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-1" role="tablist" aria-label="Sign-in method">
            {(['email', 'passcode'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  setError('');
                }}
                className={`h-9 px-4 rounded-lg text-[13px] font-medium ${tab === t ? 'bg-[var(--surface)] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-muted)]'}`}
              >
                {t === 'email' ? 'Email' : 'Passcode'}
              </button>
            ))}
          </div>
        )}

        {tab === 'email' ? (
          <EmailPane
            error={error}
            setError={setError}
            busy={busy}
            setBusy={setBusy}
            loginWithSupabase={loginWithSupabase}
          />
        ) : (
          <>
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
          </>
        )}

        <p className="mt-6 text-[11.5px] text-[var(--fg-faint)]">
          Your data stays isolated per account. No cross-user access — ever.
        </p>
      </div>
    </div>
  );
}

const inputCls =
  'mt-1 h-11 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3.5 text-[14px] text-[var(--fg)] outline-none focus:border-[var(--accent)]';

function EmailPane({ error, setError, busy, setBusy, loginWithSupabase }: {
  error: string;
  setError: (e: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  loginWithSupabase: (access: string, refresh: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'signup' | 'login' | 'reset' | 'newpass'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState('');

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : 'Something went wrong.';
    setError(msg.length > 160 ? msg.slice(0, 160) : msg);
    setBusy(false);
  };

  const go = async () => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const sb = supabase();
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) {
          setInfo('Account created — check your inbox to verify, then sign in.');
          setBusy(false);
          return;
        }
        saveSbSession(data.session);
        await loginWithSupabase(data.session.access_token, data.session.refresh_token);
      } else if (mode === 'login') {
        const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) throw new Error('No session returned — verify your email first.');
        saveSbSession(data.session);
        await loginWithSupabase(data.session.access_token, data.session.refresh_token);
      } else if (mode === 'reset') {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setInfo('Reset link sent — check your inbox.');
        setBusy(false);
      } else {
        const { data, error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        const session = (data as unknown as { session?: { access_token: string; refresh_token: string } }).session;
        if (session) {
          saveSbSession(session as Parameters<typeof saveSbSession>[0]);
          await loginWithSupabase(session.access_token, session.refresh_token);
        } else {
          setInfo('Password updated — sign in with the new password.');
          setMode('login');
          setBusy(false);
        }
      }
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="mt-6 space-y-2.5 text-left">
      <label className="block">
        <span className="text-[12px] font-medium text-[var(--fg-muted)]">Email</span>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" className={inputCls}
        />
      </label>
      {(mode === 'signup' || mode === 'login' || mode === 'newpass') && (
        <label className="block">
          <span className="text-[12px] font-medium text-[var(--fg-muted)]">
            {mode === 'newpass' ? 'New password' : 'Password'}
          </span>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go();
            }}
            placeholder={mode === 'newpass' ? 'Choose a new password' : 'Your password'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className={inputCls}
          />
        </label>
      )}
      {error && (
        <p className="text-[13px] text-red-400" role="alert">
          {error}
        </p>
      )}
      {info && (
        <p className="text-[13px] text-emerald-500" role="status">
          {info}
        </p>
      )}
      <button
        onClick={go}
        disabled={busy || !email.includes('@') || ((mode !== 'reset') && password.length < 6)}
        className="h-11 w-full rounded-xl bg-[var(--accent)] text-white text-[14px] font-semibold disabled:opacity-50 hover:brightness-110"
      >
        {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Sign in' : mode === 'reset' ? 'Send reset link' : 'Set new password'}
      </button>
      <div className="flex justify-between text-[13px]">
        <button
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError('');
            setInfo('');
          }}
          className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
        >
          {mode === 'login' ? 'New here? Create account' : 'Have an account? Sign in'}
        </button>
        {mode !== 'newpass' && (
          <button
            onClick={() => {
              setMode(mode === 'reset' ? 'login' : 'reset');
              setError('');
              setInfo('');
            }}
            className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            {mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}
          </button>
        )}
      </div>
      {mode === 'login' && (
        <button onClick={() => setMode('newpass')} className="text-[12px] text-[var(--fg-faint)] hover:text-[var(--fg-muted)]">
          Opened a reset link? Set a new password here.
        </button>
      )}
    </div>
  );
}
