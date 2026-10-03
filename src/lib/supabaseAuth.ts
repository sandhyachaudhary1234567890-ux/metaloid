// Supabase email Auth (frontend). Publishable key only — safe for browser.
// Session tokens live in localStorage; the gateway accepts Supabase JWTs
// (sb: namespace) on every route. Email confirm + password reset depend on
// Supabase Auth email delivery (custom SMTP needed for real launches).

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';

const URL = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL || '';
const ANON = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_ANON_KEY || '';

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return URL.startsWith('https://') && ANON.length > 10;
}

export function supabase(): SupabaseClient {
  if (!client) {
    if (!supabaseConfigured()) throw new Error('Supabase is not configured in this build.');
    client = createClient(URL, ANON);
  }
  return client;
}

const K = 'metaloid.sbSession.v1';

export function saveSbSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(K, JSON.stringify(s));
    else localStorage.removeItem(K);
  } catch { /* ignore */ }
}

export function loadSbSession(): Session | null {
  try {
    const raw = localStorage.getItem(K);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** access_token for gateway Bearer use (refreshes when expiring soon). */
export async function sbAccessToken(): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  let session = data.session || loadSbSession();
  if (!session) return null;
  const exp = session.expires_at || 0;
  if (exp * 1000 - Date.now() < 60000) {
    const { data: refreshed, error } = await sb.auth.refreshSession({ refresh_token: session.refresh_token });
    if (error || !refreshed.session) {
      saveSbSession(null);
      return null;
    }
    session = refreshed.session;
    saveSbSession(session);
  }
  return session.access_token;
}

export async function sbSignOut() {
  saveSbSession(null);
  try {
    await supabase().auth.signOut();
  } catch { /* already out */ }
}
