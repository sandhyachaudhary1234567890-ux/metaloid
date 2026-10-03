// One identity per request.
//
// The gateway grew two independent ways of establishing who is calling:
//
//   * `requireAuth` (auth.js) verifies the Supabase JWT locally against the
//     JWKS / public key and sets `req.user = { id, email, role }`.
//   * `attachAuth` (core/users.js) additionally supports local Bearer
//     sessions, and for Supabase tokens verifies by *introspecting*
//     /auth/v1/user over the network, setting `req.auth = { userId, ... }`.
//
// A route mounted behind `requireAuth` therefore had a locally-verified
// identity in `req.user` and a separately-acquired one in `req.auth`. They
// normally agree — but they are two answers to one question, and when they
// disagree (a missing Supabase URL, an introspection outage, a stale local
// session) the failure is silent and shape-shifting: chat read `req.auth`
// while the account API read `req.user`, so the model a user saved through
// /api/v1 was invisible to the router about to serve their next message.
//
// `identityOf` is the single answer. A locally-verified token is authoritative
// because it needs no network and cannot fail open; `req.auth` remains for
// the routes that legitimately have nothing else (local sessions).

/** @returns {string|null} the verified account id for this request. */
export function identityOf(req) {
  if (req && req.user && typeof req.user.id === 'string' && req.user.id) return req.user.id;
  if (req && req.auth && typeof req.auth.userId === 'string' && req.auth.userId && req.auth.userId !== 'guest') {
    return req.auth.userId;
  }
  return null;
}

/** Throwing variant for handlers that cannot proceed without an account. */
export function requireIdentity(req) {
  const id = identityOf(req);
  if (!id) {
    const e = new Error('Sign in to continue.');
    e.code = 'no_token';
    e.status = 401;
    throw e;
  }
  return id;
}
