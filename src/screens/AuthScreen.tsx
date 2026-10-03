// Sign in / sign up / recovery.
//
// Shown only when Supabase is configured AND there is no session — the app
// never gates the local sandbox demo behind a login. Visual language matches
// the rest of METALOID (obsidian surfaces, hairline borders, one accent).

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Mail, Lock, AlertCircle, CheckCircle2, ArrowRight, KeyRound } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { MetaIoidLockup } from '../components/brand';
import { cn } from '../lib/cn';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset' | 'verify';

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // a recovery link puts the app into "choose a new password"
  useEffect(() => {
    if (auth.recoveryMode) setMode('reset');
  }, [auth.recoveryMode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const r = await auth.signIn(email, password);
        if (!r.ok) setError(r.message || 'Could not sign in.');
      } else if (mode === 'signup') {
        const r = await auth.signUp(email, password, displayName);
        if (!r.ok) setError(r.message || 'Could not create the account.');
        else if (r.needsVerification) { setNotice(r.message || null); setMode('verify'); }
      } else if (mode === 'forgot') {
        const r = await auth.resetPassword(email);
        if (!r.ok) setError(r.message || 'Could not send the reset link.');
        else setNotice(r.message || 'Reset link sent.');
      } else if (mode === 'reset') {
        const r = await auth.updatePassword(password);
        if (!r.ok) setError(r.message || 'Could not update the password.');
        else { setNotice(r.message || 'Password updated.'); setMode('signin'); }
      }
    } finally {
      setBusy(false);
    }
  };

  const heading: Record<Mode, { title: string; sub: string; cta: string }> = {
    signin: { title: 'Sign in', sub: 'Your conversations, memory and provider keys, on every device.', cta: 'Sign in' },
    signup: { title: 'Create your account', sub: 'One identity for the web app and the Android client.', cta: 'Create account' },
    forgot: { title: 'Reset your password', sub: 'We will email you a secure link that expires shortly.', cta: 'Send reset link' },
    reset: { title: 'Choose a new password', sub: 'Use at least 8 characters.', cta: 'Update password' },
    verify: { title: 'Confirm your email', sub: 'Click the link we sent, then sign in.', cta: 'Resend email' },
  };

  const h = heading[mode];

  return (
    <div className="min-h-full h-full flex items-stretch bg-[var(--bg)] text-[var(--fg)]">
      {/* brand / value panel — hidden on small screens */}
      <div className="hidden lg:flex flex-col justify-between w-[46%] p-12 border-r border-[var(--border)] bg-[var(--bg-subtle)] relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(520px 320px at 18% 22%, var(--accent-glow), transparent 62%), radial-gradient(420px 300px at 82% 78%, rgba(129,140,248,.16), transparent 64%)',
          }}
        />
        <div className="relative">
          <MetaIoidLockup size="md" />
        </div>
        <div className="relative max-w-md">
          <h2 className="text-[30px] leading-tight font-extrabold tracking-tight">
            One private workspace for voice, vision, agents and memory.
          </h2>
          <ul className="mt-7 space-y-3.5 text-[13.5px] text-[var(--fg-secondary)]">
            {[
              'Your provider keys are encrypted server-side and never returned to a browser.',
              'Conversations, memories and tasks sync across devices — and stay yours.',
              'Row Level Security means another account cannot read your data, even with your URL.',
              'Free models first. Paid usage is never switched on silently.',
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <CheckCircle2 size={16} className="text-[var(--accent)] shrink-0 mt-0.5" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[11.5px] text-[var(--fg-muted)]">
          METALOID keeps model traffic on its own gateway — Supabase handles identity and data, never inference.
        </p>
      </div>

      {/* form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[400px]"
        >
          <div className="lg:hidden mb-8 flex justify-center">
            <MetaIoidLockup size="md" />
          </div>

          <h1 className="text-[24px] font-bold tracking-tight">{h.title}</h1>
          <p className="text-[13.5px] text-[var(--fg-muted)] mt-1.5">{h.sub}</p>

          <form onSubmit={submit} className="mt-7 space-y-3.5" noValidate>
            {mode === 'signup' && (
              <Field
                id="display-name" label="Name" icon={null} type="text" autoComplete="name"
                value={displayName} onChange={setDisplayName} placeholder="How should METALOID address you?"
              />
            )}

            {mode !== 'reset' && (
              <Field
                id="email" label="Email" icon={<Mail size={15} />} type="email" autoComplete="email"
                value={email} onChange={setEmail} placeholder="you@example.com" required
              />
            )}

            {mode !== 'forgot' && mode !== 'verify' && (
              <Field
                id="password" label="Password" icon={<Lock size={15} />} type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password} onChange={setPassword} placeholder="••••••••" required
                hint={mode === 'signup' || mode === 'reset' ? 'At least 8 characters.' : undefined}
              />
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-3">
                <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                <span className="text-[12.5px] text-red-300">{error}</span>
              </div>
            )}
            {notice && (
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-3">
                <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-[12.5px] text-emerald-300">{notice}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className={cn(
                'w-full h-11 rounded-xl text-[13.5px] font-semibold flex items-center justify-center gap-2 transition-all',
                'bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-60'
              )}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {mode === 'verify' ? 'Resend email' : h.cta}
            </button>
          </form>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
            {mode === 'signin' && (
              <>
                <button className="text-[var(--fg-muted)] hover:text-[var(--fg)]" onClick={() => { setMode('signup'); setError(null); }}>
                  Create an account
                </button>
                <button className="text-[var(--fg-muted)] hover:text-[var(--fg)]" onClick={() => { setMode('forgot'); setError(null); }}>
                  Forgot password
                </button>
              </>
            )}
            {mode !== 'signin' && (
              <button className="text-[var(--fg-muted)] hover:text-[var(--fg)]" onClick={() => { setMode('signin'); setError(null); setNotice(null); }}>
                Back to sign in
              </button>
            )}
          </div>

          <p className="mt-8 text-[11.5px] text-[var(--fg-muted)] flex items-center gap-2">
            <KeyRound size={13} className="text-[var(--fg-subtle)]" />
            Sessions are JWT-based and refresh automatically. Signing out clears this device.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  id, label, icon, hint, value, onChange, type, placeholder, autoComplete, required,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-medium text-[var(--fg-secondary)] mb-1.5">{label}</label>
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)]">{icon}</span>}
        <input
          id={id}
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-full h-11 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] text-[13.5px] text-[var(--fg)]',
            'placeholder:text-[var(--fg-subtle)] outline-none focus:border-[var(--accent)] transition-colors',
            icon ? 'pl-9 pr-3' : 'px-3'
          )}
        />
      </div>
      {hint && <p className="mt-1.5 text-[11.5px] text-[var(--fg-muted)]">{hint}</p>}
    </div>
  );
}
