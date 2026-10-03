// Shared guardrails for the Vercel serverless endpoints.
//
// These functions are the public edge of MetaIoid: they must never spend the
// owner's provider credits anonymously, never reflect arbitrary origins, never
// leak a key, and never claim a capability they have not checked.
//
// Verifying a Supabase access token with @supabase/supabase-js makes a real
// call to the project's auth server, so "authenticated" here means the token
// was accepted by Supabase — not that an environment variable exists.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

/** Explicit allowlist. No wildcard, ever. */
const ALLOWED = new Set(
  (process.env.ALLOW_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
);
const MOBILE = new Set(
  (process.env.ALLOW_MOBILE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
);
const ALLOW_PREVIEWS = process.env.ALLOW_VERCEL_PREVIEWS === 'true';
const ALLOW_LOCAL = process.env.ALLOW_LOCAL_ORIGINS === 'true' || process.env.VERCEL_ENV !== 'production';

function originAllowed(origin) {
  if (!origin) return true;                       // same-origin, curl, native app
  if (ALLOWED.has(origin) || MOBILE.has(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (ALLOW_PREVIEWS && host.endsWith('.vercel.app')) return true;
    if (ALLOW_LOCAL && (host === 'localhost' || host === '127.0.0.1')) return true;
  } catch { /* malformed → refuse */ }
  return false;
}

/** Returns true when the request may proceed; otherwise writes the refusal. */
export function guard(req, res, { methods = ['POST'] } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');

  const origin = req.headers.origin;
  if (originAllowed(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.status(originAllowed(origin) ? 204 : 403).end();
    return false;
  }
  if (origin && !originAllowed(origin)) {
    fail(res, 403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed to call MetaIoid.');
    return false;
  }
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', ['OPTIONS', ...methods].join(', '));
    fail(res, 405, 'METHOD_NOT_ALLOWED', 'That method is not supported here.');
    return false;
  }
  return true;
}

export function fail(res, status, code, message) {
  res.status(status).json({ error: message, code });
}

export const supabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON);

/**
 * Verify a Supabase access token. Returns { userId, email } or null.
 * A null token is never authenticated, even on a demo deployment.
 */
export async function authenticate(req) {
  if (!supabaseConfigured()) return null;
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${m[1].trim()}` } },
    });
    const { data, error } = await sb.auth.getUser(m[1].trim());
    if (error || !data?.user) return null;
    return { userId: data.user.id, email: data.user.email || null };
  } catch {
    return null;
  }
}

// Bounded, per-instance rate limiting. Serverless instances are short-lived,
// so this is a per-instance brake rather than a global quota — it still stops
// a single client from draining credits in a hot instance. Real global limits
// belong in front of the function (provider quota + Supabase-side limits).
const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    buckets.set(key, { start: now, count: 1 });
    if (buckets.size > 5000) buckets.clear();
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((b.start + windowMs - now) / 1000) };
  }
  return { ok: true, remaining: limit - b.count, retryAfter: 0 };
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '')).split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
}

/** Free-model-first catalogue. Every id here is a free tier; nothing paid is
 *  selected implicitly, and availability is verified per request upstream. */
export const CANDIDATE_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen-2.5-coder-32b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'mistralai/mistral-small-24b-instruct-2501:free',
];

export function pickModel(task) {
  if (task === 'coding') return CANDIDATE_MODELS[1];
  if (task === 'voice' || task === 'fast') return CANDIDATE_MODELS[2];
  return CANDIDATE_MODELS[0];
}

export const LIMITS = {
  messageChars: 8000,
  historyTurns: 10,
  historyTurnChars: 8000,
  bodyBytes: 256 * 1024,
};
