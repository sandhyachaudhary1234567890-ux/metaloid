# Backend changes required by the Android client

## Summary

**None.** This client was written against the server as it already exists in this
repository. No route, header, payload, status code or rate limit was changed,
added or relaxed, and no file under `server/` is touched by the Android work.

That is a result, not an assumption: the mapping work in `CONTRACT_MAP.md`
verified each endpoint the client uses against the server's own routes and
validators before a line of Kotlin was written. Where the client's needs and the
server's shape disagreed, the **client** changed — see §2.

## 1. What the client relies on (unchanged, and now load-bearing)

These are the server behaviours the Android client depends on. They are listed
here because changing them would be a breaking change for a shipped client, not
because anything was asked for:

| Behaviour | Where it lives server-side |
| --- | --- |
| `POST /api/chat` sends cumulative `token` frames (whole text each time) | `server/src/index.js` (chat SSE handler) |
| `meta` frame fields: `model`, `tier`, `provider`, `demo`, `byok`, `notice`, `notice_code` | same |
| `retry` frame before a failover attempt, after which the previous text is void | same |
| `done: true` terminal frame; `{error, code}` terminal failure frame with the documented codes | same |
| `: ping` heartbeat every 8 s while the model is quiet | same |
| `PATCH /api/v1/messages/:id` accepting `content`, `status`, `error_code`, `latency_ms` | `server/src/api/v1.js` |
| `POST /api/v1/conversations/:id/messages/recover` closing stale `streaming` rows as `cancelled` + `error_code='interrupted'` | `server/src/api/v1.js` + `server/src/data/*` |
| `/api/health` reporting `ai`, `byok*`, `database`, `storage.ready`, `voice`, `models`, `auth.{configured,mode}` | `server/src/index.js` |
| `/api/config` serving the public `supabaseUrl` + `supabaseAnonKey` | same |
| Refresh rotating both tokens on the same session id | `server/src/core/users.js` |
| `storage_unavailable` (501) when object storage is not configured | `server/src/api/v1.js` |

## 2. Where the client adapted instead of asking for a change

1. **Empty assistant rows are impossible.** `POST …/messages` requires non-empty
   `content`, so the client cannot pre-create a `streaming` row. It creates the
   row at the first token instead (`ChatTurnRunner`). The server was not changed;
   the client's ordering was. See `CONTRACT_MAP.md` §3.
2. **Token counts are not invented.** The stream reports no usage, so the client
   never writes `tokens` on a message or posts a usage row. The server's usage
   record therefore contains only server-measured data.
3. **Model routing stays server-side.** The client never picks a provider or a
   fallback: it sends an optional task tier (`fast`/`smart`/`voice`) and reports
   which model answered.
4. **Voice is gated on the server's own report.** `/api/health` returns
   `voice: false` here, so the client offers no voice control rather than a
   control that would fail.

## 3. If a future increment needs a server change

The rules this repository already follows, restated so they are not forgotten:

* backwards-compatible and additive only (new optional field, new route);
* the web client must be proven unaffected by running its suite;
* documented in this file *and* in `docs/ANDROID_API.md`;
* minimal — no reshaping an existing response to suit a client.

## 4. Verification that the web client is unaffected

The Android work adds files under `android/`, the workflow, and documentation;
it does not modify `server/` or `src/`. The web client's own checks
(`npm run check`, `npm run test:unit`, `npm --prefix server test`, `npm run build`)
are run before every push and their outcome is recorded in `TESTING.md`.
