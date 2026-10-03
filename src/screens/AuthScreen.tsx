// SIGN IN · SIGN UP · RECOVERY
//
// Shown only when an auth service is configured and there is no session — the
// local experience is never gated behind a login.
//
// Two rules this screen was rebuilt around:
//
//   1. The backend is invisible. The previous version explained JWTs, Row
//      Level Security and Supabase's exact role to someone who just wanted to
//      sign in. Nobody signing in to a premium product is shown its schema.
//
//   2. It is MetaIoid, not a form. Brand presence, the product's own artwork,
//      its typography and its surfaces — no gradient blobs, no third-party
//      look.

import { useEffect, useId, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Mail, Lock, AlertCircle, CheckCircle2, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { MetaIoidLockup } from '../components/brand';
import { Artwork } from '../components/ui/Artwork';
import { cn } from '../lib/cn';
import { duration, ease } from '../design/motion';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset' | 'verify';

const HEADING: Record<Mode, { title: string; sub: string; cta: string }> = {
  signin: { title: 'Welcome back', sub: 'Sign in to keep your conversations, memory and files on every device.', cta: 'Sign in' },
  signup: { title: 'Create your account', sub: 'One identity, so your work follows you.', cta: 'Create account' },
  forgot: { title: 'Reset your password', sub: 'We will email you a link that expires shortly.', cta: 'Send link' },
  reset: { title: 'Choose a new password', sub: 'Use at least eight characters.', cta: 'Update password' },
  verify: { title: 'Confirm your email', sub: 'Open the link we sent, then sign in.', cta: 'Resend email' },
};

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        else if (r.needsVerification) {
          setNotice(r.message || null);
          setMode('verify');
        }
      } else if (mode === 'forgot') {
        const r = await auth.resetPassword(email);
        if (!r.ok) setError(r.message || 'Could not send the reset link.');
        else setNotice(r.message || 'Reset link sent.');
      } else if (mode === 'reset') {
        const r = await auth.updatePassword(password);
        if (!r.ok) setError(r.message || 'Could not update the password.');
        else {
          setNotice(r.message || 'Password updated.');
          setMode('signin');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const h = HEADING[mode];
  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="flex h-full min-h-full items-stretch bg-[var(--bg)] text-[var(--fg)]">
      {/* ── Brand panel. Hidden below lg; the form stands alone on phones. ── */}
      <div className="relative hidden w-[44%] shrink-0 flex-col justify-between overflow-hidden border-r border-[var(--border)] bg-[var(--bg-subtle)] p-12 lg:flex">
        <MetaIoidLockup variant="full" size="md" />

        <div className="relative max-w-[380px]">
          <Artwork name="atmosphere" size={148} radius="xl" priority className="mb-8" />
          <h2 className="t-display text-[var(--fg)] text-balance">
            One quiet workspace for everything you think about.
          </h2>
          <p className="mt-3 text-body text-[var(--fg-muted)] text-pretty">
            Voice, vision, research and memory in a single place — private by default, and yours to leave at
            any time.
          </p>
        </div>

        <p className="text-small text-[var(--fg-subtle)]">
          Nothing here leaves your device unless you ask it to.
        </p>
      </div>

      {/* ── Form panel. ── */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.large, ease: ease.out }}
          className="w-full max-w-[380px]"
        >
          <div className="mb-9 flex justify-center lg:hidden">
            <MetaIoidLockup variant="full" size="md" />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: duration.small, ease: ease.out }}
            >
              <h1 className="t-display text-[var(--fg)]">{h.title}</h1>
              <p className="mt-1.5 text-body text-[var(--fg-muted)] text-pretty">{h.sub}</p>
            </motion.div>
          </AnimatePresence>

          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            {mode === 'signup' && (
              <Field
                id="display-name"
                label="Name"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={setDisplayName}
                placeholder="What should MetaIoid call you?"
              />
            )}

            {mode !== 'reset' && (
              <Field
                id="email"
                label="Email"
                icon={<Mail size={15} />}
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                required
              />
            )}

            {mode !== 'forgot' && mode !== 'verify' && (
              <Field
                id="password"
                label="Password"
                icon={<Lock size={15} />}
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                required
                hint={mode === 'signup' || mode === 'reset' ? 'At least 8 characters.' : undefined}
              />
            )}

            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: duration.small, ease: ease.out }}
                  className="overflow-hidden"
                >
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] px-3.5 py-3"
                  >
                    <AlertCircle size={15} className="mt-0.5 shrink-0 text-[var(--danger)]" />
                    <span className="text-small text-[var(--fg)]">{error}</span>
                  </div>
                </motion.div>
              )}

              {notice && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: duration.small, ease: ease.out }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--success)_28%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] px-3.5 py-3">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--success)]" />
                    <span className="text-small text-[var(--fg)]">{notice}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={busy}
              className="btn-primary h-11 w-full text-ui font-medium"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {busy ? 'Working…' : h.cta}
              {!busy && <ArrowRight size={15} className="opacity-70" />}
            </button>
          </form>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-small">
            {mode === 'signin' && (
              <>
                <button onClick={() => go('signup')} className="text-[var(--fg-muted)] transition-colors duration-micro hover:text-[var(--fg)]">
                  Create an account
                </button>
                <button onClick={() => go('forgot')} className="text-[var(--fg-muted)] transition-colors duration-micro hover:text-[var(--fg)]">
                  Forgot password
                </button>
              </>
            )}
            {mode !== 'signin' && (
              <button onClick={() => go('signin')} className="text-[var(--fg-muted)] transition-colors duration-micro hover:text-[var(--fg)]">
                Back to sign in
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  icon,
  hint,
  value,
  onChange,
  type,
  placeholder,
  autoComplete,
  required,
}: {
  id: string;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const reactId = useId();
  const fieldId = `${id}-${reactId}`;
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';

  return (
    <div>
      <label htmlFor={fieldId} className="mb-1.5 block text-small font-medium text-[var(--fg-secondary)]">
        {label}
      </label>

      <div className="input-shell flex h-11 items-center gap-2.5 px-3">
        {icon && <span className="shrink-0 text-[var(--fg-subtle)]">{icon}</span>}
        <input
          id={fieldId}
          type={isPassword && reveal ? 'text' : type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-ui text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="icon-btn -mr-1 h-7 w-7 shrink-0"
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>

      {hint && <p className="mt-1.5 text-small text-[var(--fg-muted)]">{hint}</p>}
    </div>
  );
}

/** Kept for callers that need the field shell elsewhere. */
export const authFieldClass = cn('input-shell flex h-11 items-center gap-2.5 px-3');
