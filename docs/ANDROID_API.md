# METALOID Android API contract

The Android client talks to the **MetaIoid gateway** and to **Supabase Auth**.
That is the whole surface. It never opens a Postgres connection, never holds the
service-role key, and never reads a table directly — table names may change,
policies may be tightened, and none of that should require a Play Store release.

```
Android app ──▶ Supabase Auth   (email + password, refresh tokens)
            └─▶ MetaIoid gateway (everything else: data, streaming, agents)
```

Two URL bases, both configured at build time:

| Base | Where it comes from | Contains |
|---|---|---|
| `SUPABASE_URL` | Supabase project settings | project ref only; public |
| `METALOID_API` | your gateway deployment | no credentials at all |

An APK must contain **no** service-role key, no JWT secret, no encryption key,
and no provider API key. (The anon key and the gateway URL are the only
identifiers that belong in a client, and both are public by design.)

---

## 1. Authentication

Supabase Auth issues the access token. Use the official SDK (`supabase-kt`) with
PKCE and secure storage for the refresh token (EncryptedSharedPreferences /
Keystore — never plain SharedPreferences, never a logged value).

* Access token = a JWT, short-lived (~1 hour). Send it as
  `Authorization: Bearer <jwt>` on **every** gateway call.
* Refresh it before it expires via the SDK. A `401 token_expired` means the
  token is past its `exp`; refresh, then retry **once**.
* `401 invalid_token` means the signature/audience/issuer did not verify —
  do not retry, sign in again.
* `503 auth_unconfigured` means the *server* has no verification key configured;
  it is an operator problem, not a client problem.

| Action | Where | Notes |
|---|---|---|
| sign up | Supabase SDK | may return no session → show "confirm your email" |
| sign in | Supabase SDK | `email_unconfirmed` until the link is opened |
| refresh | Supabase SDK | automatic in the SDK; do not hand-roll |
| password reset | Supabase SDK | sends a link; the app opens the recovery screen |
| sign out | Supabase SDK | clears the device session only |
| profile / settings | gateway `/api/v1/me` | never Supabase tables |

There is exactly one identity system. The gateway derives `user_id` from the
verified JWT on every request; a `user_id` sent in a body or query string is
ignored by design (tested).

---

## 2. Conventions

**Identity** — from the token, always. Never send `user_id`, `owner`, or
`account_id` in a body, path, or query.

**Pagination** — cursor, never offset.

```http
GET /api/v1/conversations?limit=30&cursor=<opaque>
→ { "rows": [ … ], "next_cursor": "…" | null }
```

`limit` defaults to 30, caps at 100. Pass `next_cursor` back verbatim; treat it
as opaque. A `null` cursor means the end.

**Never `SELECT *` over a big table**: list endpoints return one page and the
fields they document, and the app should request pages as the user scrolls.

**Errors** — one envelope, switch on `code`, never parse `error` prose:

```json
{ "error": "Human sentence.", "code": "not_found" }
```

| code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `no_token` | 401 | header missing | sign in |
| `invalid_token` | 401 | bad signature/audience/issuer | sign in again |
| `token_expired` | 401 | `exp` passed | refresh, retry once |
| `auth_unconfigured` | 503 | server has no JWT key | surface as service outage |
| `not_found` | 404 | missing **or not yours** | show empty state; never enumerate |
| `invalid_input` | 400 | malformed id/body | fix the call |
| `encryption_unconfigured` | 503 | server cannot store keys safely | operator problem |
| `storage_unavailable` | 501 | local driver has no object storage | hide the upload affordance |
| `provider_test_failed` | 502 | provider rejected the key | show `invalid` |
| `rate_limited` | 429 | bucket empty | back off `retry_after` seconds |
| `db_error` | 5xx | data service down | retry with backoff, keep the UI usable |

**Rate limits** are per **account** (not per IP), and every response carries
`X-RateLimit-Remaining`. A `429` includes `Retry-After` and
`{"code":"rate_limited","retry_after":n}`.

| Scope | Budget |
|---|---|
| any `/api/v1` route | 600 / minute |
| appending messages | 120 / minute |
| attachment records | 30 / minute |
| provider key write / test | 20 / minute |
| tasks + tool events | 60 / minute |
| usage telemetry | 300 / minute |
| account deletion | 5 / hour |

**Transport** — HTTPS only, `Cache-Control: no-store` is set server-side for
`/api/*`; do not add a local HTTP cache for authenticated responses. Never
cache one user's data under another user's key.

---

## 3. Profile, onboarding, preferences — `/api/v1/me`

```http
GET   /api/v1/me
PATCH /api/v1/me
DELETE /api/v1/me   body: {"confirm":"DELETE"}
```

`GET` → `{ user: { id, email }, profile: { display_name, avatar_url,
onboarding_completed, preferred_provider, preferred_model, theme,
voice_preference, memory_preference, created_at, updated_at } }`

`PATCH` accepts any subset of: `display_name` (≤80), `avatar_url` (≤500),
`onboarding_completed` (bool), `preferred_provider` (≤40), `preferred_model`
(≤120), `theme` (≤24), `voice_preference` (≤40).

`DELETE` requires `{"confirm":"DELETE"}` and **actually deletes**: storage
objects, then rows (profile, conversations, messages, attachment metadata,
memories, provider settings + credentials, agent tasks, usage links), then the
auth user. Irreversible — confirm twice in the UI.

---

## 4. Conversations and messages

```http
GET    /api/v1/conversations?limit=&cursor=
POST   /api/v1/conversations            { title?, model?, provider? }
GET    /api/v1/conversations/:id
PATCH  /api/v1/conversations/:id        { title?, archived?, model? }
DELETE /api/v1/conversations/:id        → { deleted: true }  (cascades messages)

GET    /api/v1/conversations/:id/messages?limit=&cursor=
POST   /api/v1/conversations/:id/messages
       { role, content, model?, provider?, status?, metadata? }
PATCH  /api/v1/messages/:id             { content?, status?, error_code?, tokens?, latency_ms? }
POST   /api/v1/conversations/:id/messages/recover   → { recovered: n }
```

Message `status` ∈ `streaming · complete · cancelled · error`. `role` ∈
`user · assistant · tool · system`. `content` ≤ 32 000 chars, required and
non-empty.

**The streaming contract — do not change it.** Token-by-token generation is the
gateway's job and stays on `POST /api/chat` (server-sent events), not on the
database path:

```
POST /api/chat   { "message": "...", "task": "fast|smart|vision|coding|voice",
                   "context": { … }, "history": [ { role, content } ] }
```

SSE frames (`data: {json}\n\n`):

| frame | meaning |
|---|---|
| `{"meta":{"model","tier","provider","demo"}}` | which model is answering; `demo:true` means the **local sandbox provider**, not a real model |
| `{"retry":"<slug>"}` | that model was rejected mid-flight; failover is continuing |
| `{"token":"<full text so far>"}` | **cumulative**, not a delta — replace, don't append |
| `{"done":true}` | finished |
| `{"error":"…","code":"…"}` | stable code: `no_provider · bad_key · no_credit · rate_limited · no_model · offline · timeout · server · cancelled` |

Recommended Android sequence for one turn — the visible path takes **no**
database round-trip before the first token:

1. `POST /api/v1/conversations` (new thread) or reuse `conversation_id`.
2. `POST …/messages` with `{role:"user", status:"complete"}`.
3. Open the SSE stream. Render `token` frames as they arrive.
4. On `done` → `POST …/messages` with `{role:"assistant", status:"complete",
   content: fullText, model, provider}`.
5. If the user backs out or the socket dies → `PATCH /api/v1/messages/:id`
   `{status:"cancelled"}` for the assistant row, or call `…/messages/recover`
   on the next launch so nothing is left in `streaming` forever.

`recover` exists precisely so a process death does not leave a half-written
turn open: it marks every `streaming` message in that conversation as
`cancelled` (`error_code: "interrupted"`).

---

## 5. Memories

```http
GET    /api/v1/memories?limit=&cursor=&kind=&q=
POST   /api/v1/memories   { content, category?, kind?, pinned? }
PATCH  /api/v1/memories/:id
DELETE /api/v1/memories/:id
```

`kind` ∈ `explicit · project · conversation · preference · inferred` — keep the
existing semantics. `content` ≤ 2 000 chars. Retrieval is relevance-filtered:
send `q` and/or request only the kinds you need rather than loading the vault.
The server redacts key-shaped strings before storage.

---

## 6. Providers, models, and per-user keys

```http
GET    /api/v1/provider/settings
PUT    /api/v1/provider/settings   { default_provider?, default_model?, fallback_enabled?, free_only? }
GET    /api/v1/provider/credentials
PUT    /api/v1/provider/credentials/:provider   { api_key, label? }
POST   /api/v1/provider/credentials/:provider/test   { api_key? | label? }
DELETE /api/v1/provider/credentials/:provider?label=
```

`GET /provider/credentials` returns **only**:

```json
{ "credentials": [ { "id": "…", "provider": "openrouter", "label": "default",
  "masked": "sk-or-…4f2a", "status": "connected", "key_version": "k1",
  "last_checked_at": "…", "updated_at": "…" } ] }
```

`status` ∈ `connected · invalid · unverified` — surface it as
`connected | invalid | needs setup`. There is no endpoint that returns a raw
key, and none ever will. A submitted key is encrypted at rest (AES-256-GCM
under a server-side key) and the app should clear it from memory and from the
input field the moment the call returns.

Model discovery (`GET /api/models`) is a gateway endpoint, unchanged: free and
paid slugs, with `free: true|false` and quarantined slugs flagged
`unavailable: true` (the provider rejected them recently — the gateway skips
them automatically). Free-model availability is checked dynamically; the
client must **never** silently switch a user to a paid model, and must show
`free` vs `paid` honestly.

---

## 7. Usage

```http
GET  /api/v1/usage?limit=&cursor=
POST /api/v1/usage   { provider?, model?, request_id?, task?, tokens_in?,
                       tokens_out?, latency_ms?, status? }
```

`status` ∈ `ok · error · cancelled`. **Never send prompt or completion text**,
and never send a key. This is telemetry the client is allowed to write for its
own requests.

---

## 8. Agent tasks and tool events

```http
GET   /api/v1/tasks?limit=&cursor=&status=
POST  /api/v1/tasks   { type, objective?, conversation_id? }
GET   /api/v1/tasks/:id
PATCH /api/v1/tasks/:id   { status?, progress?, result?, error? }
POST  /api/v1/tool-events { tool, state?, detail?, conversation_id?, task_id? }
```

`status` ∈ `queued · running · done · error · cancelled`; `progress` 0–100.
The same rows are queryable by the web app — that is the point: start a job on
the phone, watch it on the desktop.

---

## 9. Attachments (private storage)

```http
GET    /api/v1/attachments?limit=&cursor=&conversation_id=
POST   /api/v1/attachments   { filename, mime_type?, size_bytes?, conversation_id? }
PATCH  /api/v1/attachments/:id   { "status": "ready" | "failed" | "pending" }
GET    /api/v1/attachments/:id/url?expires=300
DELETE /api/v1/attachments/:id
```

Upload flow:

1. `POST /api/v1/attachments` →
   `{ attachment, upload: { bucket, path, storage_path } }` where

   * `upload.path` is the key **inside** the bucket: `{user_id}/{file_id}/{filename}`
     — this is what the storage SDK takes, and what the storage RLS policy
     reads when it compares the first folder against `auth.uid()`;
   * `upload.storage_path` (and `attachment.storage_path`) is the same object
     fully qualified: `attachments/{user_id}/{file_id}/{filename}`, kept so the
     database record and the object can never drift apart.

   Do **not** prefix the bucket name onto `path` yourself: `attachments/uuid/...`
   as an object key puts the literal string `attachments` where the policy
   expects your user id, and every upload is denied. (That exact mistake is
   covered by a test.)
2. Upload the bytes with the Supabase SDK to `upload.bucket` + `upload.path`
   using the **user's** token — RLS checks the leading folder.
3. `PATCH … {status:"ready"}`, or `{status:"failed"}` if the upload died.

Binary bytes go to object storage; Postgres holds metadata only. Buckets are
private — `GET …/url` returns a short-lived signed URL (30–3600 s, default 300)
after checking ownership. Limit: 50 MB per object. Never construct an object
URL by hand.

---

## 10. Health

```http
GET /api/health
```

Reports each dependency separately, from observations rather than configuration:

```json
{ "ok": true,
  "server": true, "ai": true, "degraded": false,
  "provider": "openrouter",
  "data": { "driver": "supabase", "supabase_configured": true },
  "database": true,
  "auth": { "configured": true, "mode": "jwks" },
  "provider_configured": true, "provider_healthy": true,
  "storage": { "driver": "supabase", "ok": true },
  "encryption": { "configured": true, "active_key": "k1" } }
```

The four user-visible states stay honest:

| State | Meaning |
|---|---|
| **ONLINE** | real provider reachable, real model answering |
| **SANDBOX** | the local fake provider is answering — nothing is charged, nothing is real |
| **LOCAL DEMO** | no accounts/backend configured; everything stays on the device |
| **DEGRADED** | configured but a dependency is failing; never rendered as healthy |

Android should read `/api/health` on launch and describe the state in the same
words the web app uses. Never show ONLINE because a variable exists.

---

## 11. Load characteristics

Measured with `server/tools/loadtest.mjs` — a real gateway, real JWTs, 24
simulated accounts, the request mix clients actually make (30 % list
conversations, 40 % read messages, 12 % append, 10 % usage, 5 % memories, 3 %
new conversation), **2 000 requests per level**, on a **2-vCPU sandbox** with
the **local file-backed driver** (`docs/loadtest-local.json`):

| concurrency | rps | p50 | p95 | p99 | max | errors |
|---|---|---|---|---|---|---|
| 1 | 774 | 1.1 ms | 2.2 ms | 4.4 ms | 18 ms | 0 |
| 8 | 1 288 | 4.8 ms | 13.7 ms | 24.9 ms | 89 ms | 0 |
| 32 | 1 816 | 15.0 ms | 31.0 ms | 53.6 ms | 126 ms | 0 |
| 64 | 1 912 | 30.4 ms | 62.4 ms | 128.5 ms | 264 ms | 0 |

Reproduce it yourself:

```bash
cd server && node tools/loadtest.mjs --levels 1,8,32,64 --total 2000 --json docs/loadtest-local.json
```

**Read this honestly.**

* This measures the API + repository layer against a local JSON file on two
  vCPUs. Production adds a network round-trip and Postgres work per query —
  expect lower throughput and higher latency there until this script is run
  against Supabase. It is a **floor and a method**, not a capacity estimate.
* Throughput keeps climbing to 64 concurrent workers (1.9 k rps) while latency
  queues predictably: p95 goes 2 ms → 62 ms because 64 requests share a
  fixed CPU budget, not because anything is broken. Past that point the
  bottleneck is CPU-bound JSON serialisation, and the next lever is the driver,
  not the API.
* The numbers move between runs (the earlier 1 500-request run at concurrency
  32 measured 1 139 rps / p95 83 ms on the same machine): treat them as an
  order of magnitude, not a spec.
* Zero errors means every request was answered. It says nothing about the
  model provider — no model traffic is involved — and nothing about
  multi-region behaviour.
* Per-account rate limits are enforced before the handler (600/min baseline,
  see the table above), so a *single* account is capped by policy long before
  the machine is; the load test uses 24 accounts for exactly that reason.
* No claim is made about how many *users* this supports. What it establishes is
  the per-request cost of the API layer and that it is not the first thing that
  breaks. In production the order of failure is: provider rate limits and
  free-tier quotas, then the data driver, then CPU.

## 12. What Android must never do

* Never connect to Postgres, never ship a service-role key, never bypass RLS.
* Never send a `user_id` and never trust one that arrives.
* Never persist a provider key anywhere except the gateway.
* Never render demo/sandbox output as if it were a real model.
* Never call `/api/models` or `/api/chat` through Supabase, and never route
  token streaming through the database.
