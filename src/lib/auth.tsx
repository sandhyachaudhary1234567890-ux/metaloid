// Auth state for the app.
//
// Supabase owns identity: signup, login, logout, session persistence, token
// refresh, email verification and password recovery. This module is a thin,
// honest wrapper — it never invents a session, and when Supabase is not
// configured it reports `configured: false` so the app stays in its
// documented local/sandbox mode instead of showing a login nobody can pass.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, supabaseConfigured } from './supabase';

export type AuthStatus = 'unconfigured' | 'loading' | 'signed-out' | 'signed-in';

export interface AuthResult {
  ok: boolean;
  /** Stable, human-readable message — provider text is mapped, not pasted. */
  message?: string;
  /** True when the user must confirm their email before signing in. */
  needsVerification?: boolean;
  code?: string;
}

interface AuthValue {
  configured: boolean;
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  accessToken: string | null;
  signUp: (email: string, password: string, displayName?: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  resendVerification: (email: string) => Promise<AuthResult>;
  /** Set when the user arrived from a recovery / confirmation link. */
  recoveryMode: boolean;
  clearRecoveryMode: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

/** Map Supabase's error strings onto sentences a person can act on. */
function humanizeAuthError(message: string): { message: string; code: string } {
  const m = (message || '').toLowerCase();
  if (m.includes('invalid login credentials')) return { message: 'That email and password combination is not recognised.', code: 'bad_credentials' };
  if (m.includes('email not confirmed')) return { message: 'Confirm your email address first — check your inbox for the link.', code: 'email_unconfirmed' };
  if (m.includes('user already registered')) return { message: 'An account already exists for this email. Sign in instead.', code: 'already_registered' };
  if (m.includes('password should be at least')) return { message: 'Use a password with at least 8 characters.', code: 'weak_password' };
  if (m.includes('rate limit') || m.includes('too many')) return { message: 'Too many attempts. Wait a minute and try again.', code: 'rate_limited' };
  if (m.includes('unable to validate email') || m.includes('invalid email')) return { message: 'That email address does not look valid.', code: 'bad_email' };
  if (m.includes('failed to fetch') || m.includes('network')) return { message: 'Cannot reach the auth service. Check your connection.', code: 'network' };
  return { message: message || 'Authentication failed.', code: 'auth_error' };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = supabaseConfigured();
  const [status, setStatus] = useState<AuthStatus>(configured ? 'loading' : 'unconfigured');
  const [session, setSession] = useState<Session | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  // Session bootstrap + refresh. `onAuthStateChange` also fires for token
  // refreshes, so this one subscription keeps the whole app current.
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    getSupabase().then(async (sb) => {
      if (!sb || !alive) return;
      const { data } = await sb.auth.getSession();
      if (!alive) return;
      setSession(data.session ?? null);
      setStatus(data.session ? 'signed-in' : 'signed-out');

      const { data: sub } = sb.auth.onAuthStateChange((event, next) => {
        if (!alive) return;
        setSession(next ?? null);
        setStatus(next ? 'signed-in' : 'signed-out');
        // A recovery link lands as PASSWORD_RECOVERY: show the new-password form
        if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      });
      return () => sub?.subscription?.unsubscribe?.();
    });
    return () => { alive = false; };
  }, [configured]);

  const signUp = useCallback(async (email: string, password: string, displayName?: string): Promise<AuthResult> => {
    const sb = await getSupabase();
    if (!sb) return { ok: false, message: 'This build is not connected to an auth service.', code: 'unconfigured' };
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: displayName ? { display_name: displayName.trim() } : undefined,
        emailRedirectTo: `${window.location.origin}/app/`,
      },
    });
    if (error) return { ok: false, ...humanizeAuthError(error.message) };
    // With email confirmation enabled Supabase returns a user but no session.
    const needsVerification = !data.session;
    return {
      ok: true,
      needsVerification,
      message: needsVerification ? 'Check your inbox to confirm your email, then sign in.' : 'Welcome.',
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const sb = await getSupabase();
    if (!sb) return { ok: false, message: 'This build is not connected to an auth service.', code: 'unconfigured' };
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, ...humanizeAuthError(error.message) };
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    const sb = await getSupabase();
    await sb?.auth.signOut();
    setRecoveryMode(false);
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    const sb = await getSupabase();
    if (!sb) return { ok: false, message: 'This build is not connected to an auth service.', code: 'unconfigured' };
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/app/?recovery=1`,
    });
    if (error) return { ok: false, ...humanizeAuthError(error.message) };
    return { ok: true, message: 'If that address has an account, a reset link is on its way.' };
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<AuthResult> => {
    const sb = await getSupabase();
    if (!sb) return { ok: false, message: 'This build is not connected to an auth service.', code: 'unconfigured' };
    const { error } = await sb.auth.updateUser({ password });
    if (error) return { ok: false, ...humanizeAuthError(error.message) };
    setRecoveryMode(false);
    return { ok: true, message: 'Password updated.' };
  }, []);

  const resendVerification = useCallback(async (email: string): Promise<AuthResult> => {
    const sb = await getSupabase();
    if (!sb) return { ok: false, message: 'This build is not connected to an auth service.', code: 'unconfigured' };
    const { error } = await sb.auth.resend({ type: 'signup', email: email.trim() });
    if (error) return { ok: false, ...humanizeAuthError(error.message) };
    return { ok: true, message: 'Verification email sent.' };
  }, []);

  const value = useMemo<AuthValue>(() => ({
    configured,
    status,
    session,
    user: session?.user ?? null,
    accessToken: session?.access_token ?? null,
    signUp, signIn, signOut, resetPassword, updatePassword, resendVerification,
    recoveryMode,
    clearRecoveryMode: () => setRecoveryMode(false),
  }), [configured, status, session, signUp, signIn, signOut, resetPassword, updatePassword, resendVerification, recoveryMode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
