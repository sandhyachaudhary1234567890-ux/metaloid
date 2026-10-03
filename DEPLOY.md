# MetaIoid deployment

## The production architecture (what actually runs)

One Vercel project serves **both** the landing page, the app and the API. There
is no second backend host.

```
Browser
  │
  ├─ /                → landing/            (static, dist/)
  ├─ /app/*           → dist/app/           (Vite SPA)
  └─ /api/*           → api/[...path].js    (Vercel Function)
                          │
                          ▼
                    server/src/index.js     ← the ONE gateway
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
   data driver      credential vault     model router
   (SUPABASE_DB)     (METALOID_          (provider gateway)
        │             ENCRYPTION_KEYS)         │
        ▼                                      ▼
   Supabase Postgres                    OpenRouter / NVIDIA
   + private Storage                    (server-side keys only)
```

`api/[...path].js` is a thin adapter, not a second implementation. It hands
every `/api/*` request to the same gateway that runs locally, so production and
development cannot drift apart.

> **Not the production path.** `render.yaml` is retained as a *self-hosting
> blueprint* for running the gateway as a long-lived process instead of a
> serverless function. Nothing in the current production deployment uses it.

## Environment variables

Definitions live in `server/.env.example` (server) and `.env.example`
(browser). `docs/ENV.md` is the full annotated matrix. The short version:

### Browser (Vite — bundled, public)

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Project URL. |
| `VITE_SUPABASE_ANON_KEY` | yes | Anon key. Safe to ship: RLS protects every table. |
| `VITE_API_URL` | **no** | Leave **unset** on Vercel. The app then uses same-origin `/api`, which the function serves. Only set it if the gateway is on a different host. |
| `VITE_GATEWAY_TLS` | no | Local HTTPS dev gateway only. |

Never prefix a server secret with `VITE_`: it would be bundled into the
browser and into the Android app.

### Server (Vercel Production environment — never public)

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL (server-side storage + auth introspection). |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Signs private objects, storage cleanup, account deletion. Bypasses RLS — server only, never sent to a client. |
| `SUPABASE_JWKS_URL` | yes* | Verifies user JWTs against the project's JWKS. Preferred. |
| `SUPABASE_JWT_PUBLIC_KEY` | alternative* | Static SPKI PEM. `auth.js` reads this name and only this name. |
| `SUPABASE_JWT_SECRET` | alternative* | HS256 (legacy projects without JWKS). |
| `SUPABASE_JWT_ISSUER` / `_AUDIENCE` | no | Tightens verification; audience defaults to `authenticated`. |
| `SUPABASE_DB` | yes | Must be exactly `supabase` to select the Postgres driver. There is no auto-detection: anything else — including unset — is the local JSON store, which on serverless is ephemeral. |
| `SUPABASE_DB_POOL_URL` | yes | Supabase **connection pooler** URL (transaction mode). The app caps the pool with `METALOID_PG_POOL_MAX` (default 5) so serverless instances cannot exhaust connections. |
| `METALOID_ENCRYPTION_KEYS` | yes | AES-256-GCM keyring, `k1:<base64-32-bytes>`. Absent → storing a provider key is refused with `503 encryption_unconfigured` rather than stored weakly. |
| `METALOID_ENCRYPTION_ACTIVE` | no | Which key id encrypts new writes. Defaults to the first. |
| `METALOID_CREDENTIAL_KEY` | yes | Master key for the **legacy file-mode** vault (`core/crypto.js`). Without it that path falls back to a per-boot random key, so credentials stored through it do not survive a restart. |
| `OPENROUTER_API_KEY` | yes | Free-first model routing. Server-side only. |
| `PUBLIC_APP_URL` | yes | The real production URL. Sent to the provider as `HTTP-Referer`; unset it silently falls back to `http://localhost:5173`. |
| `ALLOW_ORIGINS` | yes | Comma-separated exact origins allowed to make credentialed CORS calls. Never `*`. |
| `METALOID_MODE` | recommended | `production` disables the anonymous local-demo fallback outright. |
| `ALLOW_LOCAL_ORIGINS` / `ALLOW_VERCEL_PREVIEWS` / `ALLOW_MOBILE_ORIGINS` / `METALOID_ALLOW_ANONYMOUS` | no | Must stay **unset/false** in production. |
| `OPENROUTER_BASE`, `OPENROUTER_MODEL` | no | Provider/point override and a pinned model slug. |
| `NVIDIA_ENABLED` + `NVIDIA_API_KEY` | no | Secondary provider, off by default. Only enable with an entitled key. |
| `GITHUB_TOKEN` | no | Raises the OSINT collector's rate limit. |
| `SUPABASE_ANON_KEY` | no | Enables the `/auth/v1/user` introspection fallback. The JWKS verifier is the primary path. |
| `METALOID_AUTH_LIMIT`, `METALOID_RESPONSE_TIMEOUT_MS`, `METALOID_PROVIDER_TIMEOUT_MS`, `METALOID_JWKS_TIMEOUT_MS`, `METALOID_JOB_CONCURRENCY` | no | Rate-limit and timeout tuning. Sensible defaults; every external call already has a finite timeout. |

\* **One** JWT verifier is required. With none of the three, hosted deployments
fail closed: protected routes answer `401`/`503 auth_unconfigured` and no
anonymous identity is ever synthesised.

### Generating the production encryption keys

Run **once**, in the secure production environment, and store the result in the
secret manager. Never in Git, never in a `.env` that is committed, never in
chat.

```bash
openssl rand -base64 32        # → METALOID_ENCRYPTION_KEYS="k1:<this output>"
openssl rand -base64 32        # → METALOID_CREDENTIAL_KEY
```

Do **not** regenerate these after credentials have been stored: existing
ciphertext is bound to its key id. To rotate, add a new key to the keyring and
set `METALOID_ENCRYPTION_ACTIVE` to it; old rows keep decrypting via their own
key id.

## Deploying

Vercel builds from `master`. Environment changes only take effect in a **new**
deployment — editing variables does not retroactively fix a running one.

1. Commit to `master`.
2. Vercel builds (`npm run build` → `dist/`, function traced from
   `api/[...path].js`).
3. Verify the deployment, then confirm against the real URL:

```bash
node server/tools/preflight.mjs                 # 0 blockers, using the real env
APP_ORIGIN=https://<production-url> \
  JWT_SECRET=<the gateway's SUPABASE_JWT_SECRET> \
  node scripts/live-smoke.mjs
```

`live-smoke.mjs` reports `PASS` (exit 0), `FAIL` (exit 1) or `UNVERIFIED`
(exit 2). **`UNVERIFIED` is not a pass** — it means the target could not be
reached, so the run proved nothing.

## Database bootstrap

`supabase/bootstrap.sql` is the authoritative, idempotent schema — tables,
indexes, functions, RLS policies, grants and private storage buckets. Apply it
to the production project after reviewing it; re-running is safe.

Verify with the repository's suites rather than by eye:

```bash
npm run test:security      # RLS matrix (157 properties) + pgTAP (49 assertions)
node supabase/tests/bootstrap.pglite.mjs   # bootstrap applies cleanly + is idempotent
```

## Health

- `GET /api/health` — public. Reports **measured** component state: `ai` is
  true only when a provider key exists *and* the catalogue call answered; `auth`
  reflects the live verifier; `database` reflects the live driver. Nothing is
  hardcoded.
- `GET /api/ready` — 200 only when the process, a writable data directory and
  the provider registry are all OK. Gate load balancers on this, not `/health`.

## Operational notes

- **Auth**: Supabase owns identity. The browser holds the session; every
  protected call carries `Authorization: Bearer <access token>`, verified in
  `server/src/auth.js`. With no verifier configured, hosted deployments fail
  closed.
- **`server/.env` is a development convenience only.** Production reads the
  platform environment. `METALOID_NO_DOTENV=1` disables file loading entirely
  (the test suite uses it).
- **Rate limits** are per-user when authenticated, per-IP otherwise; auth is
  strictest (`METALOID_AUTH_LIMIT`, default 10/min).
- **Long work** (missions, investigations, skills) runs on the bounded jobs
  queue (`/api/jobs`, `/api/jobs/:id`). Chat streams and never waits on a job.
- **Cost**: BYOK providers run first only when the user connected them;
  platform free models are the fallback; budgets gate chat/missions/OSINT per
  plan. No silent paid spend — invalid keys fail loudly with reconnect guidance.
- **Logs**: `[req] <id> <method> <path> <status> <ms> user=<id>` — no secrets.
  Correlate incidents by the `X-Request-ID` response header.
