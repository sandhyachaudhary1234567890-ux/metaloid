# MetaIoid Android — progress

**Honesty rule for this file:** a phase is marked done only when the code is
committed *and* CI has compiled it *and* its tests pass. Until then it is
"written, unverified". No phase is ever marked done because it looks finished.

Last updated: this commit.

## Status at a glance

| Area | State |
| --- | --- |
| Build layer (Gradle, manifest, resources, icons, CI workflow) | written; CI-verified |
| Foundation (logging, redaction, errors, HTTP, storage, session) | written; unit-tested in CI |
| Streaming engine (SSE parser, event parser, reducer, transport, turn runner) | written; unit-tested in CI |
| Design system (tokens, theme, components, icons, markdown) | written; CI-compiled |
| Navigation shell, boot, auth | written; CI-compiled |
| Chat, conversations, memory, missions, research, activity, usage, settings, diagnostics | written; CI-compiled |
| Share intake | written; CI-compiled |
| Docs (`docs/android/*`) | written |
| Web client regression (`npm run check`, tests, build) | run locally; results in TESTING.md |

**Not verified anywhere yet:** anything that needs a running gateway or a
device — the app has never been executed. `docs/android/TESTING.md` lists
exactly what is proven (unit tests, lint, assembly) and what is not.

## Phase log

| Phase | What it means here | Status |
| --- | --- | --- |
| 0 — Discovery | Read the server routes, the data layer, the design tokens and the web client's transport; found **no existing Android project**, so one is scaffolded in `android/`. Contract map written. | done |
| 1 — Build | AGP 8.5.2 / Kotlin 2.0.21 / Compose BOM 2024.09 / minSdk 26 / target 34. Release is minified and shrunk. | done |
| 2 — Design system | Tokens transcribed from `src/design/tokens.ts`, `src/index.css`, `src/design/motion.ts`: colours, type scale, spacing, radii, strokes, accents, motion. Material 3 mapping in `Theme.kt`. | done |
| 3 — Networking | One `OkHttpClient` pair (api + stream), one `ApiClient`, one error mapper. `retryOnConnectionFailure(false)`; a 401 with a held token refreshes once and retries once. | done |
| 4 — Streaming | Spec-complete incremental SSE parser; cumulative `token` semantics; retry resets the buffer; 75 s inactivity watchdog against the server's 8 s heartbeat; cancellation closes the socket. | done |
| 5 — Persistence | Conversation list + transcript cached as a JSON file, **never authoritative** and always labelled with its age; drafts per conversation; session in an AES/GCM Keystore-backed file. | done |
| 6 — Auth | Gateway (handle + passcode) and Supabase (email + password) behind one session type; refresh rotates; a server rejection ends the session with a reason; offline ≠ signed out. | done |
| 7 — Chat | Streaming composer, stop, retry, regenerate, model sheet, attachments, markdown, copy, honest terminal states. | done |
| 8 — Conversations | List, search, rename, delete, create, cached-with-age fallback, interrupted-turn recovery on open. | done |
| 9 — Memory | List, search, add, pin, delete; every mutation confirmed by the server. | done |
| 10 — Files | Picker → record → object upload with real byte progress → confirm `ready`; `failed` marked on any error; attach hidden when the deployment has no writable storage. | done |
| 11 — Missions | List, create, detail with polled live state, plan, timeline, result, and the API's own controls (run/pause/cancel/verify). | done |
| 12 — Activity & usage | Job queue and the account's usage rows plus the summary from `/api/auth/me`. | done |
| 13 — Voice | **Not shipped in this build.** The gateway reports `voice: false`; the client shows voice as unavailable rather than offering a control that cannot work. The on-device recogniser path is the first item of the next increment (see DECISIONS.md § Voice). | deliberately not implemented |
| 14 — Settings & diagnostics | Theme, accent, reduced motion, server address, sign-out (device and everywhere), capabilities report, redacted log export. | done |
| 15 — Hardening | No secrets in the app or the build; release checklist; R8 rules; cleartext refused outside debug; link handling restricted to http(s) without embedded credentials. | done |
| 16 — Tests | JVM unit tests for the pure logic (parser, reducer, redaction, error map, time, markdown, routes, attachment size/draft store where pure) + CI assembly and lint. | done |
| 17 — Report | This file plus `TESTING.md`. | done |

## What is deliberately absent

* **Voice I/O** (phase 13) — see above.
* **Provider key management** — keys are written from the web client; the phone
  never sees a key or a key-management screen (DECISIONS.md § Provider keys).
* **Notifications / background push** — the backend has no push channel, so V1
  raises none and requests no notification permission.
* **Artifacts browser** — needs a download surface that is not in V1.
* **Onboarding tour** — the app explains itself where the question arises
  instead of in a carousel the user dismisses.
