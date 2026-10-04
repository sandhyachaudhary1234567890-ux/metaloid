# MetaIoid Android — contract map

Every gateway endpoint this client calls, where it is called from, and what the
client does with the answer. This file is the map between the server's contract
(`docs/ANDROID_API.md`, the server source) and the client code.

**Truth order used while writing it:** the running server's routes and
validators in `server/src/**` first, then `docs/ANDROID_API.md`, then the web
client (`src/lib/**`). Where the three disagree, the server wins and the
disagreement is recorded at the bottom of this file.

The client never invents an endpoint. If something is not in this table, the
Android app cannot do it.

## 1. Health, configuration, models

| Endpoint | Client | Used by | Notes |
| --- | --- | --- | --- |
| `GET /api/health` | `MetaIoidApi.health()` | `AppViewModel.checkHealth`, boot screen, diagnostics | Drives the capability set (`ai`, `byok`, `database`, `storage.ready`, `voice`, `models.catalogue`) and the status line. **Never** cached as "live": every screen states the state it is in. |
| `GET /api/config` | `MetaIoidApi.publicConfig()` | `AppViewModel.checkHealth` | Supplies `supabaseUrl` + `supabaseAnonKey` when they were not baked into the build. Public values by design; no secret is accepted here. |
| `GET /api/models` | `MetaIoidApi.listModels()` | chat (model sheet) | Purely informational in the UI; routing stays server-side. |
| `GET /api/v1/provider/settings` | `MetaIoidApi.providerSettings()` | chat (model sheet) | The account's stored default model. |
| `PUT /api/v1/provider/settings` | `MetaIoidApi.updateProviderSettings(defaultModel=…)` | chat (model sheet) | The only way a model preference is stored, so every device agrees. |

## 2. Streaming chat

| Endpoint | Client | Notes |
| --- | --- | --- |
| `POST /api/chat` (SSE) | `core/streaming/StreamTransport` (`OkHttpStreamTransport`) | `Authorization: Bearer <access token>`, `Accept: text/event-stream`, body `{message, history:[{role,content}], task?, context?}`. |

Frames, exactly as the server documents and sends them:

| Frame | Meaning | Client behaviour |
| --- | --- | --- |
| `data: {"meta":{model,tier,provider,demo,byok,notice,notice_code}}` | Which model answered, and whether it was the local sandbox (`demo:true`) | Stored on `StreamState`; the UI shows "Sandbox reply" when `demo` is true and the `notice` when the platform key took over after a BYOK failure. |
| `data: {"retry":"<model>"}` | Failover: the previous attempt's text is gone | `StreamReducer` moves the text to `supersededText`, clears the buffer, increments `attempt`, and the UI says a retry happened. Text is never stitched across attempts. |
| `data: {"token":"<cumulative full text>"}` | The **whole** text so far — replace, never append | `StreamReducer` replaces `text`. A shrink that is not immediately after a retry is counted as an anomaly and the longer text is kept. |
| `data: {"done":true}` | Terminal success | Phase becomes `Completed`; `ChatTurnRunner` finalises the assistant row. |
| `data: {"error":"…","code":"…"}` | Terminal failure | Mapped by `ErrorMapper.fromStreamCode`; codes: `no_provider`, `bad_key`, `no_credit`, `rate_limited`, `no_model`, `offline`, `timeout`, `cancelled`, `server`, `credential_unreadable`. `cancelled` is a *cancellation*, not an error. |
| `: ping` (comment) | Heartbeat every 8 s | Parsed as a comment frame and discarded; it exists so the client can tell a quiet stream from a dead socket. The transport aborts after 75 s of complete silence. |

Stop is a client-side abort (closing the call). There is no stop endpoint, and
the app does not pretend otherwise.

## 3. Conversations and messages (`/api/v1`)

Identity always comes from the bearer token; no endpoint takes a user id, and
the client never sends one.

| Endpoint | Client | Notes |
| --- | --- | --- |
| `GET /api/v1/conversations` | `ConversationsRepository.refreshConversations()` | Newest first; the list is cached locally and the cache is labelled with its age, never presented as live. |
| `POST /api/v1/conversations` | `ConversationsRepository.create()` | Title may be null; the server names it. |
| `GET /api/v1/conversations/:id` | `ConversationsRepository` (transcript refresh) | — |
| `PATCH /api/v1/conversations/:id` | `ConversationsRepository.rename()` | Optimistic on screen, **rolled back** if the server refuses. |
| `DELETE /api/v1/conversations/:id` | `ConversationsRepository.delete()` | Removed on screen immediately, restored on failure. |
| `POST /api/v1/conversations/:id/messages` | `ChatTurnRunner` (user message; first-token assistant row) | `{role, content, model?, provider?, status, metadata?}`. |
| `GET /api/v1/conversations/:id/messages` | `ConversationsRepository.loadMessages()` | Oldest first. |
| `PATCH /api/v1/messages/:id` | `ChatTurnRunner` (finalisation) | `{content, status, error_code?, latency_ms?}`. |
| `POST /api/v1/conversations/:id/messages/recover` | `ConversationsRepository.recoverInterrupted()` | Called when a conversation is opened: closes rows the server still has in `status='streaming'` (they become `cancelled` + `error_code='interrupted'`). This is what makes a process death mid-answer honest. |

### Why the assistant row is created at the first token

`POST …/messages` rejects an empty `content` (validator: non-empty string). So
the client cannot open a placeholder row before the model speaks. The order the
runner uses is therefore:

1. store the user's message (`status='complete'`);
2. stream;
3. on the **first** token, create the assistant row with the text so far and
   `status='streaming'` (asynchronously, so token delivery is not delayed by a
   round-trip);
4. on `done` / stop / error, `PATCH` that row once with the final text, status
   and (on success) the measured latency.

Consequences, both intended:

* the server can never hold a row for an answer that never started, so no empty
  assistant bubble is ever created;
* a turn killed mid-stream leaves a `streaming` row that the server's own
  `recover` endpoint closes as `cancelled`/`interrupted` — with the partial text
  preserved, because that text was already on the server.

`tokens` is **not** written by the client: the stream does not report token
counts, and inventing them would put a fabricated number in the server's usage
record. `latency_ms` *is* written, because it is measured.

## 4. Identity

| Endpoint | Client | Notes |
| --- | --- | --- |
| `POST /api/auth/signup`, `login`, `refresh`, `logout`, `logout-all` | `MetaIoidApi` via `GatewayAuthApi` → `SessionManager` | Gateway accounts (handle + passcode). Refresh rotates both tokens on the same session id. |
| `GET /api/auth/me` | `MetaIoidApi.authMe()` | Account, profile and the usage summary shown on the Usage screen. |
| `POST /auth/v1/token?grant_type=password`, `POST /auth/v1/signup`, `POST /auth/v1/token?grant_type=refresh_token`, `POST /auth/v1/logout` | `SupabaseAuthClient` | Only when the deployment has a Supabase project. Headers: `apikey: <anon>`, `Content-Type: application/json`. |

One session object holds either issuer (`AuthMode.GATEWAY` / `AuthMode.SUPABASE`).
The mode changes exactly one capability: object-storage uploads need a Supabase
token, so a gateway-local account sees the attach button disabled and the reason
stated.

## 5. Files

| Endpoint | Client | Notes |
| --- | --- | --- |
| `POST /api/v1/attachments` | `AttachmentsRepository.upload()` | Returns the record plus the upload target (`{bucket, path, storage_path}`; `path` is the bucket-internal key). |
| `PUT {supabaseUrl}/storage/v1/object/{bucket}/{path}` | `AttachmentsRepository` | Sent as the **user**, with the session's Supabase access token — never a service-role key. Body is a byte-counted progress stream. |
| `PATCH /api/v1/attachments/:id` | `AttachmentsRepository` | Confirms `ready` after the object exists, or marks `failed` if it does not. |
| `GET /api/v1/attachments/:id/url` | `AttachmentsRepository.signedUrl()` | 30–3600 s. |
| `DELETE /api/v1/attachments/:id` | `AttachmentsRepository.delete()` | — |

Client-side limit: 50 MB (the server's own limit). The picker grants per-URI
access; the app never asks for storage permissions.

## 6. Memory, missions, research, jobs, usage

| Endpoint | Client | Screen |
| --- | --- | --- |
| `GET/POST /api/v1/memories`, `PATCH/DELETE /api/v1/memories/:id` | `MetaIoidApi` | Memory |
| `POST/GET /api/missions`, `GET /api/missions/:id`, `POST /api/missions/:id/{run,pause,cancel,verify}` | `MetaIoidApi` | Missions, mission detail |
| `POST/GET /api/osint/investigations`, `GET /api/osint/investigations/:id`, `POST …/:id/run`, `POST …/:id/findings` | `MetaIoidApi` | Research |
| `GET /api/jobs` | `MetaIoidApi.listJobs()` | Activity |
| `GET /api/v1/usage`, `GET /api/auth/me` | `MetaIoidApi.listUsage()` / `authMe()` | Usage |

Statuses are shown in the server's own vocabulary (`RUNNING`, `BLOCKED`,
`VERIFIED`, …). The client does not translate them into softer synonyms, because
those words carry the meaning the screen exists to convey.

## 7. Deliberate omissions

| Not used | Why |
| --- | --- |
| `POST /api/v1/usage` | Usage is the server's record of what it served. A client-posted row could contradict it, and the endpoint is rate-limited for a reason. |
| `POST /api/v1/tool-events` | The voice tool path is not enabled in V1; writing events for tools the app does not run would be fiction. |
| `/api/providers`, `/api/devices`, `/api/workspaces`, `/api/agent/*`, `/api/world/*`, `/api/verify`, `/api/profile`, `/api/onboarding` | Not part of the Android V1 surface. Provider keys are deliberately not manageable from the phone in V1 (provider write limits: 20/min) — recorded in DECISIONS.md. |
| Artifacts (`/api/artifacts*`) | Needs a download/attachment UI that V1 does not ship. |

## 8. Known divergences found while mapping

1. **`/api/chat` is behind Supabase-or-gateway auth, but `/api/models` is not
   token-scoped.** The app sends the token when it has one and treats an
   unauthenticated answer as such.
2. **`docs/ANDROID_API.md` describes a pre-created assistant row** ("insert a
   streaming row before streaming"). The server's validator rejects empty
   content, so the client creates the row at the first token instead (§3). The
   documented *intent* — never leave a phantom complete answer — is preserved.
3. **Token counts in `/api/v1/usage` are the server's.** The chat stream does not
   report usage, so the client cannot and does not attribute tokens to a turn.
