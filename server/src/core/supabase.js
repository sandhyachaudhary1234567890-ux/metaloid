// Supabase bridge — verifies Supabase Auth JWTs so Supabase-authenticated
// users work end-to-end on the gateway. Strategy: introspect via
// /auth/v1/user (no JWT secret needed), cache 60s per token hash.
// Local Bearer sessions are tried FIRST (zero-latency local path stays).

const URL = process.env.SUPABASE_URL || '';
const ANON = process.env.SUPABASE_ANON_KEY || '';

const cache = new Map(); // tokenHash -> { user, exp }
let cryptoMod = null;
async function sha(s) {
  if (!cryptoMod) cryptoMod = await import('node:crypto');
  return cryptoMod.createHash('sha256').update(String(s)).digest('hex');
}

export function supabaseConfigured() {
  return URL.length > 10 && ANON.length > 10;
}

/** Returns { id, email } or null. Never throws. */
export async function supabaseUser(accessToken) {
  if (!supabaseConfigured() || !accessToken) return null;
  try {
    const h = await sha(accessToken);
    const hit = cache.get(h);
    if (hit && hit.exp > Date.now()) return hit.user;
    if (cache.size > 500) cache.clear();
    const r = await fetch(URL + '/auth/v1/user', {
      headers: { apikey: ANON, Authorization: 'Bearer ' + accessToken },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.id) return null;
    const user = { id: u.id, email: u.email || null };
    cache.set(h, { user, exp: Date.now() + 60000 });
    return user;
  } catch {
    return null;
  }
}
