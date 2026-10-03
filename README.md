# METALOID

**A private personal AI operating system.** One loop, end to end:

> open → ask → think → answer → speak / show / tool → memory / history

Voice, vision, agent missions, a memory vault and a model router behind one
calm surface. The gateway holds the keys; the browser never sees them.

```
┌ site ────────────────┐   ┌ product ─────────────┐   ┌ gateway ─────────────┐
│ /  landing page      │ → │ /app/  the assistant │ → │ :8787  /api + SSE    │
└──────────────────────┘   └──────────────────────┘   └──────────┬───────────┘
                                                                 │
                                                    OpenRouter / NVIDIA /
                                                    sandbox provider
```

---

## Quickstart — the whole product in two minutes

```bash
npm install
cd server && npm install && cd ..

npm run showcase      # → http://localhost:5173
```

`showcase` starts three things: a **sandbox provider** (streams real SSE tokens
locally, no key, no network), the **gateway**, and the **app**. The full loop —
streaming replies, missions, memory, voice mode — works immediately.

The sidebar shows **SANDBOX**, not ONLINE. That is the point: the app never
pretends. Set a real key and it flips to **ONLINE** with live models.

### Live models

Create `server/.env`:

```ini
OPENROUTER_API_KEY=sk-or-...
ALLOW_ORIGINS=http://localhost:5173
BIND_HOST=127.0.0.1
```

```bash
npm run gateway       # :8787
npm run dev           # :5173  (landing at /, product at /app/)
```

Optional: `OPENROUTER_MODEL` pins a preferred model, `OPENROUTER_BASE` points
at a compatible proxy or a local fake.

---

## Four real states, never a fake green dot

Most assistants show a green light whatever is happening. METALOID has four
distinct, truthful states, and the UI switches between them automatically:

| State | Meaning | What the user sees |
|---|---|---|
| **ONLINE** | a live provider answered | real model output |
| **SANDBOX** | a local/sandbox provider is serving | working demo, clearly labelled |
| **DEGRADED** | a key is set but unreachable | told the truth instead of silence |
| **LOCAL DEMO** | no gateway at all | in-browser engine, every message marked demo |

`GET /api/health` reports the same thing, from facts:

```json
{
  "server": true, "ai": true, "degraded": false,
  "data": { "driver": "supabase", "supabase_configured": true },
  "database": true,
  "auth": { "configured": true, "mode": "jwks" },
  "provider_configured": true, "provider_healthy": true,
  "storage": { "driver": "supabase", "ok": true },
  "encryption": { "configured": true, "active_key": "k1" }
}
```

`provider_healthy` is only true when a key is present **and** the provider
actually answered the catalogue call — never because a variable is set.
`database`, `auth` and `storage` are measured the same way, and an unconfigured
one reports `configured: false` rather than a hopeful green tick.

---

## Accounts, sync, and production data

METALOID runs in two honest modes and says which one it is in:

| Mode | What you get | How to enter it |
|---|---|---|
| **Development** | everything on-device, no accounts, no network identity required. Not a shipping configuration. | leave `VITE_SUPABASE_*` empty |
| **Account** | real Supabase identity (email + password, verification, reset), conversations/memories synced to Postgres, per-user provider keys, usage + tasks queryable by web *and* Android | set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |

**Division of labour** — Supabase owns identity, Postgres, RLS and private
object storage. The MetaIoid gateway keeps owning chat, streaming, provider
routing, agent runtime, research/browser/voice and business logic. *Model
traffic never goes through Supabase.* The browser talks to the gateway with the
user's own JWT, so Postgres evaluates RLS as that user; the service-role key
exists only to sign private objects and to complete an account deletion.

### Environment matrix

One table, three classes. Nothing in the first class may ever appear in the
second, and a value is never duplicated across both.

**PUBLIC — bundled into the browser.** Safe because the anon key can do
nothing RLS does not allow, and the API URL is just an address.

| Variable | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Project URL. Public by design. |
| `VITE_SUPABASE_ANON_KEY` | RLS-scoped. Public by design. |
| `VITE_API_URL` | Gateway origin. Leave unset in local dev (Vite proxies `/api`). |

**SERVER-ONLY — the gateway process.** Never in a `VITE_*` variable, never in
the repo, never in a response body. Provider keys go in through the API,
are encrypted with `METALOID_ENCRYPTION_KEYS`, and are never returned —
`GET /api/v1/provider/credentials` emits a mask (`…0000`) and nothing else.

| Variable | Why it is secret |
|---|---|
| `SUPABASE_DB`, `SUPABASE_DB_POOL_URL` | Direct database access; selecting the durable driver. |
| `SUPABASE_JWT_PUBLIC_KEY` \| `SUPABASE_JWKS_URL` \| `SUPABASE_JWT_SECRET` | Token verification. This is the only thing that makes a request's identity trustworthy. |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. Used for signed URLs and account erasure, always with an explicit `user_id` predicate. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Server-side token introspection fallback. |
| `METALOID_ENCRYPTION_KEYS`, `METALOID_ENCRYPTION_ACTIVE` | Wraps every stored provider key. Without them the gateway refuses to store a key at all rather than writing it in the clear. |
| `OPENROUTER_API_KEY`, `NVIDIA_API_KEY` | Platform provider credit. |
| `METALOID_MODE=production` | Disables the local anonymous fallback outright. |
| `ALLOW_ORIGINS` | CORS allow-list. |
| `GITHUB_TOKEN` | Only for the codebase-index tools. |

**OPTIONAL — behaviour tuning with a sane default.**

| Variable | Default |
|---|---|
| `METALOID_DATA_DIR` | `server/data` locally, `/tmp/metaloid` on Vercel |
| `BIND_HOST`, `PORT` | `0.0.0.0`, `8787` |
| `OPENROUTER_BASE`, `NVIDIA_BASE` | The vendor endpoints. Point them at a proxy or an OpenAI-compatible gateway. |
| `METALOID_MODE=showcase`, `METALOID_ALLOW_ANONYMOUS` | Off. Enables the same-machine anonymous owner identity for demos only. |
| `METALOID_PG_POOL_MAX`, `METALOID_JOB_CONCURRENCY`, `METALOID_AUTH_LIMIT` | `5`, `2`, `20` |
| `ALLOW_LOCAL_ORIGINS`, `ALLOW_MOBILE_ORIGINS`, `ALLOW_VERCEL_PREVIEWS` | Off |
| `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` | Unset, `authenticated` |
| `PUBLIC_APP_URL` | Unset |

### Setting up Supabase

1. **Create the project**, then *Project Settings → API* and copy the project
   URL plus the **anon** key into `.env.local` (see `.env.example`). The anon
   key is safe in the browser — it can do nothing that RLS does not allow.
2. **Apply the migrations** in order. They are the only description of the
   schema — there is no second `schema.sql` to paste, because one used to
   exist and had drifted into a database the gateway could not query:

   ```bash
   supabase link --project-ref <ref>
   supabase db push          # supabase/migrations/*.sql, in order
   ```

   `0001_core_schema.sql` (tables, UUIDs, FKs, cursors, indexes),
   `0002_rls_and_grants.sql` (owner-only RLS on every user table, grants,
   trigger for `profiles`), `0003_storage.sql` (private buckets and their
   policies), then the platform migrations `001`–`006`
   (credential audit trail, user-id widening for mixed-id deployments — a
   no-op on the Supabase-shaped schema, credential rotation, missions/world/
   skills/artifacts/workspaces/devices/jobs/rate counters, pairing codes,
   artifact soft-delete). They are plain SQL — re-runnable on any Postgres 15+.

   Buckets: `attachments`, `generated`, `avatars` and `artifacts`, all
   **private**; downloads are signed URLs created after an ownership check.

   Proof, not assertion: `node supabase/tests/rls.pglite.mjs` applies every
   migration to a real PostgreSQL engine, rebuilds the Supabase environment and
   then grants `anon`/`authenticated` **full** table privileges — the worst case
   a project can be in — so the 157 properties it checks come from the policies
   rather than from a missing grant.

   **A production deployment must set `SUPABASE_DB=supabase` and
   `SUPABASE_DB_POOL_URL`.** Without them the gateway falls back to a local
   JSON store, which on a serverless host is `/tmp`: the app looks like it
   works and loses every conversation when the instance recycles.
   `/api/health` reports the live driver as `data.driver`, so the difference is
   visible rather than silent.
3. **Configure the gateway** from `server/.env.example`: service-role key, anon
   key, JWT verification settings, and `METALOID_ENCRYPTION_KEYS`. Without the
   encryption key the gateway refuses to store provider credentials rather than
   storing them weakly.
4. **Turn on email** — *Authentication → Providers → Email*, and set the
   redirect URLs to `<site>/app/`. Verification and password-reset links land
   back on the app, which opens the right screen.
5. **Verify**: `GET /api/health` reports `ai`, `database`, `auth`
   (`configured` / `mode` / `reachable`), `storage`, `encryption`,
   `data.driver`, `models.free` and `degraded` separately, from probes it
   actually ran — it never reports ONLINE because an environment variable
   exists, and `models.free` stays `0` until a provider key reaches the
   catalogue. `/api/ready` is the stricter check used by uptime monitors.

### Environment variables

| Variable | Side | Why |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | **client-safe** | the anon key is designed to be public; RLS is what protects data |
| `VITE_API_URL` | **client-safe** | where the gateway lives |
| `OPENROUTER_API_KEY`, `NVIDIA_API_KEY` | server-only | billed provider credentials |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | bypasses RLS; used for signing private objects, storage cleanup and account deletion |
| `SUPABASE_JWKS_URL` (+ `_ISSUER`, `_AUDIENCE`) | server-only | verifies user JWTs without a shared secret |
| `METALOID_ENCRYPTION_KEYS`, `_ACTIVE` | **server-only** | encrypts stored provider keys (`openssl rand -base64 32`) |
| `METALOID_DATA_DRIVER`, `METALOID_DATA_DIR` | server-only | `supabase` in production, `local` for the demo |
| `ALLOW_ORIGINS`, `BIND_HOST`, `PORT` | server-only | CORS allow-list and listen address |

The full matrix — every variable classified PUBLIC / SERVER-ONLY / OPTIONAL /
REQUIRED, with the honest failure mode of each — is in
[`docs/ENV.md`](docs/ENV.md). Production, Preview and Development are
configured separately; changing a variable only takes effect in a new
deployment.

The gateway refuses to start a request path that needs a missing secret rather
than degrading quietly: no JWT key → `auth: unconfigured` and `503`; no
encryption key → it will not store a provider key at all.

### Provider secrets

A submitted key is encrypted with AES-256-GCM under a key from the environment
and stored in a **versioned envelope**: `v1:<keyId>:<iv>:<tag>:<ciphertext>`.
Responses contain only a mask (`sk-or-…4f2a`) and one of
`connected | invalid | needs_setup`; there is no route that returns plaintext,
and no log line that contains one. Rotation is a config change, not a
migration: add `k2` to `METALOID_ENCRYPTION_KEYS`, point
`METALOID_ENCRYPTION_ACTIVE` at it, and re-encrypt as rows are rewritten — the
old key keeps decrypting until nothing references it.

### Storage

Three **private** buckets — `attachments`, `generated`, `avatars` — with objects
namespaced `{user_id}/{file_id}/{filename}` inside them (the policy compares the
first folder to `auth.uid()`; `attachments.storage_path` keeps the
fully-qualified path for auditability). Clients never construct a URL:
`GET /api/v1/attachments/:id/url` checks ownership and returns a signed link
that expires in 30–3600 s (default 300). Bytes stay out of Postgres; the
database holds metadata only.

### Testing your own setup

```bash
npm test                    # typecheck, unit, gateway, security and end-to-end
npm run test:unit           # app contract tests (vitest)
npm run test:integration    # gateway API tests, real HTTP, real data driver
npm run test:security       # RLS: 157 properties + the pgTAP suite
npm run test:e2e            # signup → login → onboarding → chat → logout → reload
supabase test db            # the same RLS matrix, against your project
npm run showcase            # landing at /, app at /app/, gateway on 8787
```

Counts at this release: 49 app tests, 37 gateway tests, 157 executed RLS
properties, 49 pgTAP assertions and 24 end-to-end checks — all green, and no
test was removed to get there.

## What is inside

| Layer | Where | What it does |
|---|---|---|
| Experience | `src/screens`, `src/components` | Chat · History · Research · Settings (camera, tools and voice open contextually) |
| Local agent runtime | `src/lib/agent`, `src/lib/voice`, `src/lib/skills` | planning, checkpoints, quality metrics, barge-in voice loop, skill forge |
| Transport | `src/lib/transport.ts` | the only file that touches the network; relative URLs + scheme rescue |
| Gateway | `server/src/index.js` | CORS lock, rate limits, SSE, hardening, graceful drain |
| Agent kernel | `server/src/core` | missions, permissions, verification, memory, world model, audit |
| Model router | `server/src/openrouter.js` | task routing, failover, dead-slug quarantine, honest errors |
| Skills & tools | `server/src/skills`, `server/src/tools` | OSINT collectors, research helpers, tool catalogue |

Deeper documents: [`docs/ANDROID_API.md`](docs/ANDROID_API.md) (the API contract
both clients build against, plus measured load characteristics) ·
[`ARCHITECTURE.md`](ARCHITECTURE.md) ·
[`VOICE_ARCHITECTURE.md`](VOICE_ARCHITECTURE.md) ·
[`voicetest/RESULTS.md`](voicetest/RESULTS.md)

---

## Reliability, because free models churn

The bug that shaped this layer: a free model slug that the provider no longer
serves does **not** return 404. It returns **HTTP 400 — "The request contains
invalid parameters"** — and that raw sentence used to land in the user's face.

Now:

- **every** model rejection (`400 / 403 / 404 / 429 / 5xx`) fails over to the
  next candidate inside the same stream;
- a rejected slug is **quarantined for an hour** and never retried — the second
  question does not pay for the first one's dead model;
- `401 / 402` fail **fast** — a bad key or an empty balance is not fixed by
  trying another model;
- SSE-level errors and silent empty streams count as failures, not successes;
- the user gets one calm sentence plus a stable code
  (`no_provider · bad_key · no_credit · rate_limited · no_model · offline ·
  timeout · server`); provider JSON stays in the server log;
- `/api/models` **flags** quarantined slugs instead of hiding them, so the
  model picker can explain itself.

## Tests

```bash
npm test          # typecheck + 86 tests + 205 security assertions
```

- **49 app tests** (vitest + jsdom): transport contract, the account layer
  (unconfigured build stays local, session restore, sign-out, recovery mode,
  and every Supabase error translated into a sentence a person can act on),
  the `/api/v1` repository contract (no identity in any request body, masked
  credentials only, cursor pagination, delete confirmation, signed URLs), the
  four connection states, every screen rendering (including Live with no
  camera), a full chat round-trip with stubbed SSE, and the voice segmenter —
  including the Devanagari danda regression that once stopped Hindi from being
  spoken.
- **37 gateway tests** (node:test): 13 against `server/tests/fake-provider.mjs`
  (a controllable provider that fails the first N models, returns 401/429,
  emits an empty stream or drops the socket — so failover, quarantine, error
  honesty and a clean SIGTERM drain are proven, not asserted), 15 API/authz
  tests over the `/api/v1` surface (including per-account rate-limit
  isolation), and 9
  credential-encryption tests that run in separate child processes so a
  rotation or a missing key genuinely proves something.

```bash
npm run test:app        # frontend only
npm run test:server     # gateway only
npm run test:rls        # RLS security matrix (no database server needed)
npm run test:server -- --watch
```

**Row Level Security is executed, not asserted.** Two suites prove the same
matrix — anonymous SELECT/INSERT/UPDATE/DELETE, owner CRUD, non-owner
SELECT/UPDATE/DELETE, private-storage path isolation, and account-deletion
cascades:

```bash
npm run test:rls     # both suites, no database server required
```

- `supabase/tests/rls.pglite.mjs` applies the real migrations to PGlite
  (PostgreSQL compiled to WebAssembly), recreates `auth.uid()` / `auth.users` /
  the `storage` schema, then probes **157 properties**. It grants `anon` and
  `authenticated` full table privileges first, so whatever blocks an attacker is
  the *policy*, not a missing GRANT — and every probe runs as a non-superuser,
  because a superuser bypasses RLS and would prove nothing.
- `supabase/tests/rls_pgtap.pglite.mjs` runs `supabase/tests/rls_test.sql`
  (plan 48) unmodified against the same stack with a minimal pgTAP
  implementation, so the file you run against your hosted project is a file
  that has actually been run.

On a real project, run the same file with `supabase test db`. Running these
found three real bugs before deployment: `storage.objects` RLS was only
platform-default rather than stated in the migration; the attachment upload key
handed to clients repeated the bucket name (which the storage policy — correctly
— rejects); and the pgTAP helpers set a `role` GUC instead of switching role, so
the hosted suite would not have tested what it claimed.

The application-level half of the same story (identity always from the JWT,
never from the request body) is covered by the API tests above.

---

## Deploy

**Site + app → Vercel** (root `/` is the landing page, `/app/` the product —
`vercel.json` handles the rewrites and asset caching):

```
VITE_API_URL = https://<your-gateway-host>   # set before the first build
```

**Gateway → Render / Railway / Fly** (it must be a persistent process:
in-memory missions, OSINT jobs, long SSE streams — it cannot be serverless):

| Variable | Value |
|---|---|
| `BIND_HOST` | `0.0.0.0` |
| `ALLOW_ORIGINS` | `https://<your-site>` |
| `OPENROUTER_API_KEY` | your key (**rotate anything ever pasted in chat**) |
| `NVIDIA_ENABLED` | `false` unless the account is entitled |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | project URL + anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** — object signing, deletion |
| `SUPABASE_JWKS_URL` (+ `_ISSUER`, `_AUDIENCE`) | verifies user JWTs |
| `METALOID_ENCRYPTION_KEYS` / `_ACTIVE` | `openssl rand -base64 32`, rotation-friendly |
| `METALOID_DATA_DRIVER` | `supabase` in production, `local` for the demo |

Health check: `GET /api/health` reports `database`, `auth`, `provider_configured`,
`provider_healthy` and `storage` as separate observed facts — an unset variable
never reads as ONLINE. `render.yaml` is a blueprint. Full variable list, marked
client-safe vs server-only, in `.env.example` and `server/.env.example`.

**Backup, restore, rollback.** Take backups with `supabase db dump` (daily at
minimum) plus Storage object versioning; restore into a scratch project, run
`supabase/tests/rls_test.sql` there, and only then point DNS at it. Rollback of
an app deploy is a Vercel/Render revert; rollback of a *schema* change is a new
forward migration — migrations are append-only, never edited in place. An
encryption-key rotation is `METALOID_ENCRYPTION_KEYS` gaining a `k2`, then
`METALOID_ENCRYPTION_ACTIVE=k2`, then a re-encrypt backfill; old keys are kept
until every row has been rewritten.

### Same-Wi-Fi phone testing

Both servers can serve TLS from `certs/` (generate with
`cd server && node certs-gen.mjs`), which is what unlocks mic capture on a
phone. Details and firewall notes: [`server/README.md`](server/README.md).

---

## Security posture

- provider keys live only in the gateway's environment, never in the bundle;
- the gateway binds `127.0.0.1` by default and the showcase keeps it loopback —
  an auth-less API fronting paid keys must not sit on the open internet;
- CORS is an explicit allow-list (the machine's own LAN origins are added
  automatically for phone testing, never `*`);
- the gateway sets `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  a `Permissions-Policy`, and `no-store` on every `/api/` response;
- input caps on every route (message length, body size), per-IP rate limits,
  unhandled-rejection armour, and a graceful drain on SIGTERM;
- nothing secret is ever logged, and `server/src/core/memory.js` redacts
  key-shaped strings before they can be stored as memories;
- **RLS is mandatory on every user table** — owner-only policies, no
  `USING (true)`, and the gateway holds a user-scoped client built from the
  caller's JWT for normal traffic;
- the service-role key is used for exactly three jobs (signing private objects,
  storage cleanup during deletion, deleting the auth user) and never reaches a
  browser, an APK, a repo or a response;
- user provider API keys are stored **encrypted** with AES-256-GCM under a key
  from the environment, in a versioned envelope
  (`v1:<keyId>:<iv>:<tag>:<ciphertext>`); API responses contain only
  `connected | invalid | needs_setup` plus a masked identifier such as
  `sk-or-…4f2a`. There is no route that returns a raw key, and no log line
  that contains one;
- demo mode can never masquerade as a real connection: SANDBOX / LOCAL DEMO /
  ONLINE / DEGRADED are computed from observed facts.

## Layout

```
landing/               marketing page (served at /)
src/                   the product (served at /app/)
  lib/transport.ts     the only network layer
  lib/voice/           streaming voice loop
  lib/supabase.ts      the only place the browser client is created
  lib/auth.tsx         sessions: signup, login, verify, reset, sign-out
  lib/repo.ts          the only place the app calls /api/v1
  screens/AuthScreen.tsx
server/                gateway (Express + SSE)
  src/openrouter.js    model router, failover, quarantine
  src/api/v1.js        the authenticated product API (web + Android)
  src/auth.js          JWT verification (JWKS / public key / HS256)
  src/crypto.js        AES-256-GCM envelope for provider credentials
  src/data/            local + Supabase drivers behind one interface
  tools/loadtest.mjs   measured load, not claimed load
  tests/               gateway + API tests, fake provider
supabase/
  migrations/          0001 schema · 0002 RLS · 0003 storage
  tests/rls_test.sql   pgTAP: anonymous / owner / non-owner on every table
docs/ANDROID_API.md    the contract Android builds against
scripts/showcase.mjs   one-command demo
```

## Status

Working today: streaming chat with failover · voice loop with barge-in ·
vision path · missions with approvals and checkpoints · research workspace with
reports · memory vault with redaction · model router and picker · landing page ·
real accounts with verified email, sync, per-user provider keys, usage and
agent-task state · 86 tests + 205 security assertions · deploy-ready build.

The interface is deliberately small: **Chat · History · Research · Settings**,
with camera, tools and voice opening only when they are relevant. Chat is the
product — a small identity line, the conversation, and a composer whose whole
surface is `+ Message MetaIoid… 🎙 ↑` with everything optional behind that `+`.
Boot fades into the workspace in under a second; navigation is instant with no
blocking transition; light mode is designed rather than inverted; and
`prefers-reduced-motion` turns off every non-essential animation, in CSS and in
framer-motion.

Local-first by default and account-backed when you want it: point the app at a
Supabase project and conversations, memories, preferences and tasks follow the
user across devices — including the Android client, which talks only to these
APIs and never to the tables. Provider keys are yours; nothing is proxied
through anyone else.

**Known limits, stated honestly:** the load numbers are in
[`docs/ANDROID_API.md`](docs/ANDROID_API.md#11-load-characteristics) — measured on
a laptop against the local driver, not on production Supabase, so treat them as
a lower bound and a bottleneck list rather than a capacity claim. RLS policies
ship as SQL with pgTAP tests that must be run against a real database. There is
no admin console, no team/org model, and no billing.
