# METALOID — environment matrix

Every variable the product reads, classified by where it may live. "Required"
means the named capability does not work without it; a missing optional value
degrades to a stated, visible state — never to a silent success.

Secrets are never printed by the app, the gateway, the health endpoint, the
logs or this document. `server/.env.example` and `.env.example` carry the
templates; only the *values* lives in the environment.

## PUBLIC — bundled into the browser

Safe by design: the Supabase **anon** key grants nothing on its own because
every table is protected by Row Level Security, and every gateway route needs a
verified user token.

| Variable | Required | Purpose / failure mode |
|---|---|---|
| `VITE_SUPABASE_URL` | optional | Project URL. Absent → the app runs in local/sandbox mode (no accounts, on-device data); nothing pretends to be signed in. |
| `VITE_SUPABASE_ANON_KEY` | optional (with the URL) | Public key for Auth + RLS-protected reads. |
| `VITE_API_URL` | optional | Gateway base URL. Unset → same-origin `/api` (dev-server proxy, or the deployment's own function). **Leave unset on Vercel**, where `/api/*` is served by `api/[...path].js` in the same project. |
| `VITE_GATEWAY_TLS` | optional | `true` makes the local dev client talk to the dev gateway over `https://` (needed for microphone access from a LAN address). Local development only. |

Never public: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
`METALOID_ENCRYPTION_KEYS`, any provider key. A `VITE_` prefix on those would
ship them to every visitor and into the Android bundle.

## SERVER-ONLY — gateway (`server/.env`) and Vercel functions

| Variable | Required | Purpose / failure mode |
|---|---|---|
| `OPENROUTER_API_KEY` | optional but the usual way to be online | Free-first model routing. Absent → `/api/health` reports `ai:false`, `provider:null`, `degraded:false`; chat answers with "no provider configured" (503 before any stream). |
| `NVIDIA_API_KEY` + `NVIDIA_ENABLED=true` | optional | Secondary provider. Off by default: a key without function entitlements would only produce misleading "both providers failed" messages. |
| `SUPABASE_URL` | required for server-side storage/auth work | Project URL. Used to introspect Supabase sessions and to address the storage API. |
| `SUPABASE_SERVICE_ROLE_KEY` | required for server-side storage/account work | Signs private objects, storage cleanup, account deletion. Absent → those routes refuse; nothing is served unsigned. Bypasses RLS, so it never reaches the browser. |
| `SUPABASE_ANON_KEY` | optional | Enables the `/auth/v1/user` introspection fallback in `core/supabase.js`. The JWKS verifier is the primary path; this is a second opinion, not the identity source. |
| `SUPABASE_JWKS_URL` | required in production auth | Verifies user JWTs against the project's JWKS. Absent (with no other verifier) → `/api/health` shows `auth: { configured:false, reachable:true }` and user-data routes answer `503 auth_unconfigured`. |
| `SUPABASE_JWT_SECRET` | alternative | HS256 verification for projects without JWKS. |
| `SUPABASE_JWT_PUBLIC_KEY` | alternative | Static public-key verification (SPKI PEM). `auth.js` reads this name and only this name — a deployment that sets a different one is not authenticated. |
| `SUPABASE_JWT_AUDIENCE` / `_ISSUER` | optional | Tightens verification; defaults to `authenticated`. |
| `METALOID_ENCRYPTION_KEYS`, `METALOID_ENCRYPTION_ACTIVE` | required to store provider keys | AES-256-GCM envelope `v1:<keyId>:<iv>:<tag>:<ct>`. Absent → the gateway refuses to store a credential rather than storing it weakly. No hardcoded fallback key exists. |
| `METALOID_CREDENTIAL_KEY` | required for the legacy file-mode vault | Master key for `core/crypto.js`, used by the older `credentialVault` surface. Without it that module falls back to a **per-boot random key**, so credentials written through it do not survive a restart. The `/api/v1` credential path does not use this — it uses `METALOID_ENCRYPTION_KEYS`. Set both. |
| `SUPABASE_DB` | required for durable storage | `supabase` selects the Postgres driver. Anything else — including unset — is the local JSON store. There is no auto-detection. |
| `SUPABASE_DB_POOL_URL` | required with `SUPABASE_DB=supabase` | Postgres connection string, from Supabase's **connection pooler** (transaction mode) for serverless runtimes. |
| `METALOID_PG_POOL_MAX` | optional | Max pooled connections per instance (default 5). Keeps many serverless instances from exhausting the pooler. |
| `METALOID_JWKS_TIMEOUT_MS` | optional | JWKS fetch timeout (default 5000). Fail fast: every protected route waits on this. |
| `METALOID_PROVIDER_TIMEOUT_MS` | optional | Provider response-header timeout (default 30000). |
| `METALOID_RESPONSE_TIMEOUT_MS` | optional | Overall response budget (default 50000). |
| `GITHUB_TOKEN` | optional | Raises the OSINT collector's GitHub rate limit. |
| `METALOID_DATA_DIR` | optional | Where the local driver keeps state. Serverless filesystems are ephemeral — production uses Supabase. |
| `METALOID_NO_DOTENV` | testing only | Skip loading `server/.env`. Set by the test suite so a developer cannot change what is under test. |
| `ALLOW_ORIGINS` | required in production | Comma-separated allowlist of web origins. Unlisted origins get no CORS grant and a 403 on state-changing routes; there is no wildcard path. |
| `ALLOW_MOBILE_ORIGINS` | optional | Origins of the trusted Android/desktop clients, if any. |
| `ALLOW_VERCEL_PREVIEWS` | optional | `true` also trusts `*.vercel.app` previews. Off in production. |
| `ALLOW_LOCAL_ORIGINS` | optional | `true` trusts `localhost`/`127.0.0.1` origins. Development only. |
| `METALOID_MODE` | optional | `production` disables the anonymous local-demo fallback for `/api/chat`; `showcase` opts into it deliberately for a local demo. |
| `PUBLIC_APP_URL` | required in production | The real application URL, sent to the provider as `HTTP-Referer`. Unset it falls back to `http://localhost:5173`, so a production deployment that omits it identifies itself to the provider as a localhost app. |
| `BIND_HOST`, `PORT` | optional | Listen address (default `0.0.0.0`) and port. Ignored on serverless hosts, which own the lifecycle. |
| `METALOID_AUTH_LIMIT` | optional | Requests per minute for auth routes. Chat uses the per-user limiter in `limits.js`. |

## Storage and queue

| Concern | Where it lives | Failure mode |
|---|---|---|
| Attachments / generated files / avatars / artifacts | Private Supabase Storage buckets, objects named `{user_id}/{file_id}/{filename}`; downloads are signed links created after an ownership check | No service-role key → no signed URL; the UI says the file cannot be opened rather than showing a dead link |
| Job queue | Gateway process (agent tasks, skills, missions) with persisted state | On serverless, long jobs run in the gateway/worker, not in a request; a function never silently drops work |

## Production vs Preview vs Development

Set variables **per environment** in Vercel, then redeploy — environment changes
only take effect in a new deployment:

* **Production**: real Supabase project (production URL + keys), production
  `ALLOW_ORIGINS`, production provider key, `ALLOW_VERCEL_PREVIEWS` unset.
* **Preview**: may point at a staging Supabase project and a test provider key.
  Never the production service-role key.
* **Development**: local gateway, `ALLOW_LOCAL_ORIGINS=true`, demo/sandbox mode
  allowed.

A deployment with no provider key and no Supabase project is a legitimate,
honest state: `/api/health` reports `ai:false`, `auth.configured:false`,
`data.driver:"local"` and the app shows local demo mode. It never reports
ONLINE — and `METALOID_MODE=production` refuses anonymous chat outright.
