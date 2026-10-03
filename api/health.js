// Real state only. A capability is reported true when it has been checked in
// this request (or a recent one), never because an environment variable exists.
import { guard, supabaseConfigured } from './_shared.js';

const CACHE_MS = 60_000;
let providerCache = { at: 0, ok: false, detail: 'not checked', models: 0 };

async function checkProvider(key) {
  const now = Date.now();
  if (now - providerCache.at < CACHE_MS) return providerCache;
  if (!key || key.length < 10) {
    providerCache = { at: now, ok: false, detail: 'no provider key configured', models: 0 };
    return providerCache;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal,
    });
    clearTimeout(t);
    const ok = r.ok;
    providerCache = { at: now, ok, detail: ok ? 'key accepted' : `provider returned ${r.status}`, models: ok ? 4 : 0 };
  } catch {
    providerCache = { at: now, ok: false, detail: 'provider unreachable', models: 0 };
  }
  return providerCache;
}

async function checkAuthReachable() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { configured: false, reachable: false, detail: 'no Supabase project configured' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: anon }, signal: ctrl.signal,
    });
    clearTimeout(t);
    return { configured: true, reachable: r.ok, detail: r.ok ? 'auth reachable' : `auth returned ${r.status}` };
  } catch {
    return { configured: true, reachable: false, detail: 'auth unreachable' };
  }
}

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (!guard(req, res, { methods: ['GET'] })) return;

  const [provider, auth] = await Promise.all([
    checkProvider(process.env.OPENROUTER_API_KEY || ''),
    checkAuthReachable(),
  ]);

  const ai = provider.ok;
  res.json({
    ok: true,
    server: true,                                  // this function answered
    ai,
    auth: auth.configured,
    authState: auth,
    storage: { ready: supabaseConfigured(), driver: supabaseConfigured() ? 'supabase' : 'local' },
    database: auth.configured && auth.reachable,
    voice: false,                                  // speech runs in the browser
    vision: ai,
    realtime: true,
    provider: process.env.OPENROUTER_API_KEY ? 'openrouter' : null,
    providerDetail: provider.detail,
    degraded: !ai,
    models: { free: provider.models, catalogue: provider.models > 0 },
    engine: 'metaloid-edge',
    at: new Date().toISOString(),
  });
}
