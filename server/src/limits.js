// Rate limiting.
//
// Two flavours, both in-memory and both deliberately boring:
//   * `rateLimit`     — per client IP, for the unauthenticated legacy routes;
//   * `userRateLimit` — per *account*, for everything behind a verified JWT.
//
// The per-user key matters: one signed-in user behind a shared NAT, or one
// leaked token, must not be able to spend another user's budget. Buckets are
// swept as they are touched and never grow without bound.

const buckets = new Map();

/** Drop buckets whose window has fully elapsed. Runs opportunistically. */
function sweep(now) {
  if (buckets.size < 500) return;
  for (const [key, entry] of buckets) {
    if (now - entry.started > entry.windowMs * 2) buckets.delete(key);
  }
}

function take(key, max, windowMs) {
  const now = Date.now();
  sweep(now);
  const entry = buckets.get(key);
  const fresh = !entry || now - entry.started > windowMs;
  const state = fresh ? { started: now, count: 0, windowMs } : entry;
  state.count += 1;
  buckets.set(key, state);
  const remaining = Math.max(0, max - state.count);
  return {
    allowed: state.count <= max,
    remaining,
    retryAfter: Math.max(1, Math.ceil((state.started + windowMs - now) / 1000)),
  };
}

function reject(res, limit) {
  res.setHeader('Retry-After', String(limit.retryAfter));
  res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
  return res.status(429).json({
    error: 'Rate limited. Slow down.',
    code: 'rate_limited',
    retry_after: limit.retryAfter,
  });
}

/** Per-IP limiter (legacy/demo routes). */
export function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const limit = take(`ip:${req.ip || 'local'}`, max, windowMs);
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) return reject(res, limit);
    next();
  };
}

/**
 * Per-account limiter. Requires `requireAuth` to have run first; falls back to
 * the IP only for the window before a user is attached (never for a request
 * that carries a token).
 */
export function userRateLimit(max, windowMs) {
  return (req, res, next) => {
    const who = req.user?.id ? `u:${req.user.id}` : `ip:${req.ip || 'local'}`;
    const limit = take(`${who}:${max}/${windowMs}`, max, windowMs);
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) return reject(res, limit);
    next();
  };
}

/** Exposed for tests: forget every bucket. */
export function resetLimits() {
  buckets.clear();
}
