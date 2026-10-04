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
const BUILD_URL = (env.VITE_SUPABASE_URL || '').trim();
const BUILD_ANON = (env.VITE_SUPABASE_ANON_KEY || '').trim();

// Runtime fallback: Vercel won't save JWT-looking VITE_ values, and Vite
// inlines VITE_ at build time (post-build env changes are invisible anyway).
// The gateway serves the same public values at /api/config (anon key is
// public by design; RLS protects data), so a build with empty VITE_ vars
// still connects. Resolved once per page load.
let runtime: { url: string; anon: string } | null = null;
let runtimePromise: Promise<{ url: string; anon: string } | null> | null = null;

async function runtimeConfig(): Promise<{ url: string; anon: string } | null> {
  if (BUILD_URL && BUILD_ANON) return null; // build-time wins, no fetch needed
  if (runtime) return runtime;
  if (!runtimePromise) {
    runtimePromise = (async () => {
      try {
        const res = await fetch('/api/config', { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const j = (await res.json()) as { supabaseUrl?: string; supabaseAnonKey?: string };
        const url = (j.supabaseUrl || '').trim();
        const anon = (j.supabaseAnonKey || '').trim();
        if (!url || !anon) return null;
        runtime = { url, anon };
        return runtime;
      } catch {
        return null;
      }
    })();
  }
  return runtimePromise;
}

function buildTimeConfigured(): boolean {
  return Boolean(BUILD_URL && BUILD_ANON);
}

let client: SupabaseClient | null = null;
let clientKey = '';
let loading: Promise<SupabaseClient | null> | null = null;

export function supabaseConfigured(): boolean {
  // Sync answer from build-time env (fast path). The async getSupabase()
  // below additionally tries /api/config, so an empty build still connects
  // after one fetch — callers that need certainty should await getSupabase().
  return buildTimeConfigured() || Boolean(runtime);
}

export function supabaseUrl(): string {
  return runtime?.url || BUILD_URL;
}

/** Resolve the client once. Returns null when the app is unconfigured. */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (client) return Promise.resolve(client);
  if (!loading) {
    loading = (async () => {
      let url = BUILD_URL;
      let anon = BUILD_ANON;
      if (!url || !anon) {
        const rt = await runtimeConfig();
        if (rt) {
          url = rt.url;
          anon = rt.anon;
        }
      }
      if (!url || !anon) return null;
      const { createClient } = await import('@supabase/supabase-js');
      const key = `${url}|${anon.slice(-12)}`;
      if (client && clientKey === key) return client;
      client = createClient(url, anon, {
        auth: {
          persistSession: true,      // session survives a reload
          autoRefreshToken: true,    // and refreshes itself before expiry
          detectSessionInUrl: true,  // email confirmation + recovery links
          flowType: 'pkce',
        },
      });
      clientKey = key;
      return client;
    })();
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
  const url = supabaseUrl();
  return { configured: supabaseConfigured(), url: supabaseConfigured() ? url : null };
}
