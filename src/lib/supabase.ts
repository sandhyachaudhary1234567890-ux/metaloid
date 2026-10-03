// Supabase browser client.
//
// Only the PUBLIC anon key ever lives here. The service-role key bypasses RLS
// and therefore belongs exclusively to the gateway (server/.env) — it is never
// imported, bundled, or referenced from this file.
//
// The client is created lazily: an app running without Supabase (the sandbox
// showcase, an offline demo) must not pay for it, and must keep working.

import type { SupabaseClient, Session } from '@supabase/supabase-js';

// Read through a cast: the app compiles with the DOM lib only, and these
// values are optional by design (an unconfigured build must still run).
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
const URL_ = (env.VITE_SUPABASE_URL || '').trim();
const ANON = (env.VITE_SUPABASE_ANON_KEY || '').trim();

let client: SupabaseClient | null = null;
let loading: Promise<SupabaseClient | null> | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(URL_ && ANON);
}

export function supabaseUrl(): string {
  return URL_;
}

/** Resolve the client once. Returns null when the app is unconfigured. */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!supabaseConfigured()) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (!loading) {
    loading = import('@supabase/supabase-js').then(({ createClient }) => {
      client = createClient(URL_, ANON, {
        auth: {
          persistSession: true,      // session survives a reload
          autoRefreshToken: true,    // and refreshes itself before expiry
          detectSessionInUrl: true,  // email confirmation + recovery links
          flowType: 'pkce',
        },
      });
      return client;
    });
  }
  return loading;
}

/** The client if it has already been created (sync), else null. Used by
 *  callers that must not force a lazy import — never a second client. */
export function peekSupabase(): SupabaseClient | null {
  return client;
}

/** Current session, or null. Never throws. */
export async function getSession(): Promise<Session | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ?? null;
}

/** Access token for gateway calls, refreshed if it is close to expiring. */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  return session?.access_token ?? null;
}

/** Which auth provider is live — surfaced in the UI, no secrets. */
export function authRuntime(): { configured: boolean; url: string | null } {
  return { configured: supabaseConfigured(), url: supabaseConfigured() ? URL_ : null };
}
