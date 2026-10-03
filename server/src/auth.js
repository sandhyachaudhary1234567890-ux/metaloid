// Supabase Auth verification for the gateway.
//
// The gateway never sees passwords and never mints sessions: Supabase owns
// identity, the browser holds the session, and every protected API call
// arrives with `Authorization: Bearer <supabase access token>`. This module
// verifies that token and produces the ONLY trustworthy identity in a
// request: `req.user.id`.
//
// Order of trust (highest first):
//     verified JWT `sub`  →  never the request body, never a query param
//
// Verification supports both current Supabase signing modes:
//   * asymmetric (recommended): ES256/RS256, keys fetched from the project's
//     JWKS endpoint and cached (jose handles rotation + caching)
//   * legacy symmetric: HS256 with the project JWT secret
//
// If neither is configured, the gateway is honest about it: identity is
// unavailable, protected routes say so with 503 `auth_unconfigured`, and the
// app stays in its documented local/sandbox mode rather than pretending.

import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from 'jose';

/**
 * Our own error type. jose attaches its own `.code` (ERR_JWT_EXPIRED,
 * ERR_JWS_SIGNATURE_VERIFICATION_FAILED, …) to the errors it throws, so a
 * bare truthiness check on `.code` would re-throw library errors as if they
 * were already normalised. This marker keeps the two apart.
 */
function gatewayError(message, code, status = 401) {
  return Object.assign(new Error(message), { code, status, metaloid: true });
}

const JWKS_URL = (process.env.SUPABASE_JWKS_URL || '').trim();
const JWT_SECRET = (process.env.SUPABASE_JWT_SECRET || '').trim();
const EXPECTED_ISSUER = (process.env.SUPABASE_JWT_ISSUER || '').trim();
const EXPECTED_AUD = (process.env.SUPABASE_JWT_AUDIENCE || 'authenticated').trim();

// Local test/dev key: an explicit PEM public key (or JWKS file served by a
// test server) avoids any network dependency in CI.
const PUBLIC_KEY_PEM = (process.env.SUPABASE_JWT_PUBLIC_KEY || '').trim().replace(/\\n/g, '\n');

let jwks = null;
function getJwks() {
  if (!jwks && JWKS_URL) {
    jwks = createRemoteJWKSet(new URL(JWKS_URL), {
      // jose's defaults are tens of seconds with retries. Every protected route
      // waits on this, so an unreachable identity provider would stall the whole
      // app and surface as a spinner. Fail fast instead, and let the caller
      // retry once the network recovers.
      timeoutDuration: Number(process.env.METALOID_JWKS_TIMEOUT_MS || 5000),
      cooldownDuration: 30_000,
    });
  }
  return jwks;
}

/**
 * Did verification fail because we could not reach the signing keys, or because
 * the token itself is bad? The two need different answers: one is retryable and
 * is our problem, the other is not and is the caller's. Reporting an outage as
 * "session expired" sends the user to re-authenticate for nothing.
 */
function isKeyFetchFailure(e) {
  if (!e) return false;
  const fingerprint = `${e.code || ''} ${e.name || ''} ${e.message || ''} ${e.cause?.code || ''} ${e.cause?.message || ''}`;
  if (/ERR_JWKS_NO_MATCHING_KEY|ERR_JWT_|JWTClaimValidationFailed|JWSInvalid|JWSSignatureVerificationFailed/i.test(fingerprint)) {
    return false; // we reached the keys and the token was the problem
  }
  return /ERR_JWKS_TIMEOUT|ERR_JWKS_INVALID|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|UND_ERR|TimeoutError|network/i.test(fingerprint);
}

let secretKey = null;
async function getSecretKey() {
  if (!secretKey && JWT_SECRET) secretKey = new TextEncoder().encode(JWT_SECRET);
  return secretKey;
}

let pemKey = null;
async function getPemKey() {
  if (!pemKey && PUBLIC_KEY_PEM) {
    const { importSPKI } = await import('jose');
    pemKey = await importSPKI(PUBLIC_KEY_PEM, 'ES256').catch(async () => importSPKI(PUBLIC_KEY_PEM, 'RS256'));
  }
  return pemKey;
}

export function authConfigured() {
  return Boolean(JWKS_URL || JWT_SECRET || PUBLIC_KEY_PEM);
}

/** Which verification mode is live — surfaced by /api/health, no secrets. */
export function authMode() {
  if (JWKS_URL) return 'jwks';
  if (PUBLIC_KEY_PEM) return 'public-key';
  if (JWT_SECRET) return 'hs256';
  return 'unconfigured';
}

/**
 * Verify a Supabase access token.
 * @returns {{ id: string, email?: string, role?: string, claims: object }}
 * @throws  {Error & { code: string, status: number }}
 */
export async function verifyToken(token) {
  if (!authConfigured()) {
    throw gatewayError('Supabase auth is not configured on this gateway.', 'auth_unconfigured', 503);
  }
  const opts = {
    issuer: EXPECTED_ISSUER || undefined,
    audience: EXPECTED_AUD || undefined,
    clockTolerance: '5s',
  };
  try {
    const header = decodeProtectedHeader(token);
    let key;
    if (header.alg === 'HS256') {
      key = await getSecretKey();
      if (!key) {
        throw gatewayError('Token is HS256 but no SUPABASE_JWT_SECRET is configured.', 'auth_unconfigured', 503);
      }
    } else if (PUBLIC_KEY_PEM && !JWKS_URL) {
      key = await getPemKey();
    } else {
      key = getJwks();
      if (!key) {
        throw gatewayError('No Supabase signing key available for this token.', 'auth_unconfigured', 503);
      }
    }
    const { payload } = await jwtVerify(token, key, opts);
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    // A Supabase *anon* key is a valid JWT but is not a user identity.
    if (!sub || /anon/i.test(String(payload.role || ''))) {
      throw gatewayError('Token does not identify a user.', 'invalid_token', 401);
    }
    return {
      id: sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      role: typeof payload.role === 'string' ? payload.role : undefined,
      claims: payload,
    };
  } catch (e) {
    if (e && e.metaloid) throw e; // already ours
    if (isKeyFetchFailure(e)) {
      throw gatewayError(
        'Cannot reach the identity provider to verify your session. Try again in a moment.',
        'auth_unavailable',
        503
      );
    }
    const fingerprint = `${e && e.code || ''} ${e && e.name || ''} ${e && e.message || ''}`;
    const expired = /exp/i.test(fingerprint);
    throw gatewayError(
      expired ? 'Session expired — sign in again.' : 'Invalid or unverifiable session token.',
      expired ? 'token_expired' : 'invalid_token',
      401
    );
  }
}

function bearer(req) {
  const h = req.headers?.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
}

/**
 * Express middleware: require a verified Supabase session.
 * On success sets `req.user = { id, email, role }` and `req.accessToken`.
 */
export function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Sign in to continue.', code: 'no_token' });
  }
  verifyToken(token).then(
    (user) => {
      req.user = user;
      req.accessToken = token;
      next();
    },
    (e) => {
      const status = e.status || 401;
      res.status(status).json({ error: e.message, code: e.code || 'invalid_token' });
    }
  );
}

/**
 * Optional auth: attaches req.user when a valid token is present, otherwise
 * continues. Used only where anonymous access is legitimate (health, public
 * catalogue reads).
 */
export function optionalAuth(req, res, next) {
  const token = bearer(req);
  if (!token || !authConfigured()) return next();
  verifyToken(token).then(
    (user) => { req.user = user; req.accessToken = token; next(); },
    () => next()
  );
}
