// Supabase email auth — an ADAPTER, not a second client.
//
// The browser has exactly one Supabase client (`lib/supabase.ts`) and exactly
// one session store (the client's own persistence + the mirror in
// `lib/auth.tsx`). This module keeps the small surface the store and the
// components grew up with, so nothing needs two live sessions that can drift
// apart — a stale cached copy of a session is a security bug, not a cache.

import type { Session } from '@supabase/supabase-js';
import { getSupabase, supabaseConfigured as configured, peekSupabase } from './supabase';
import { mirrorSupabaseSession } from './auth';

export function supabaseConfigured(): boolean {
  return configured();
}

/** The live client. Throws when this build has no Supabase project, which is
 *  the honest answer: callers must check `supabaseConfigured()` first. */
export function supabase() {
  const client = peekSupabase();
  if (!client) throw new Error('Supabase is not configured in this build.');
  return client;
}

/** Load the client (creating it on first use). */
export async function supabaseClient() {
  return getSupabase();
}

/** Kept for callers that hand a session over explicitly — the mirror is what
 *  the rest of the app reads, and the client owns persistence. */
export function saveSbSession(s: Session | null) {
  mirrorSupabaseSession(s);
}

/** Always the client's own current session; never a second stored copy. */
export function loadSbSession(): Session | null {
  return null;
}

/** access_token for gateway Bearer use (refreshed when close to expiry). */
export async function sbAccessToken(): Promise<string | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) return null;
  mirrorSupabaseSession(session);
  return session.access_token;
}

/** The refresh token of the live session, when the gateway's local-driver
 *  refresh path needs one. Supabase itself keeps refreshing in the client. */
export async function sbRefreshToken(): Promise<string | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.refresh_token ?? null;
}

export async function sbSignOut() {
  mirrorSupabaseSession(null);
  try {
    const sb = await getSupabase();
    await sb?.auth.signOut();
  } catch { /* already out */ }
}
