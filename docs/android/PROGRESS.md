# MetaIoid Android — progress

**Honesty rule for this file:** a phase is marked done only when the code is
committed *and* CI has compiled it *and* its tests pass. Until then it is
"written, unverified". No phase is ever marked done because it looks finished.

Historical baseline: the published V3 release is `apk-v3` (see
`docs/android/RELEASE.md`). V4 is committed to the Arena working branch, but it
is **not ready to publish**: latest run `37219304680` passed JVM tests, lint,
and debug APK assembly, then failed at `:app:connectedDebugAndroidTest`. Its
report had no instrumented JUnit XML, screenshot, or useful ADB/window/logcat
diagnostics, and omitted the Gradle root cause. The test-report artifact and
Actions log both failed to download here with EOF, so it remains unknown whether
this was an emulator/ADB failure or an app/test failure. The next workflow
captures ADB device/boot state and the Gradle failure context. Earlier runs
failed on the emulator boot timeout (`37213918933`), the action's POSIX shell
(`37216103307`), the Gradle working directory (`37213055749`, `37213710373`),
or the signed-out assertion (`37211404025`, `37217266554`). The workflow now
uses the emulator action's explicit Android working directory, allows 900
seconds for boot, and invokes Bash diagnostics via one helper command.

## Current V4 increment — compiled, partially verified; not release-ready

Changes include backend-backed first-run provider setup and readiness gating,
Smart Connect plus server-catalog model selection, route persistence, chat
retry/finalization metadata fixes, and related regression coverage. GitHub
Actions compiled the app and passed JVM tests, lint, and debug APK assembly in
run `37219304680`, but `:app:connectedDebugAndroidTest` failed without producing
instrumented-test JUnit XML or screenshot/ADB/window diagnostics. The comment
report omitted the Gradle root cause; its test-report artifact and job log could
not be downloaded due EOF. Runs `37211404025` and `37217266554` separately failed
to observe the signed-out screen; `37217266554` had only an XML declaration in
its hierarchy. Runs `37213055749` and `37213710373` failed before instrumentation
because Gradle ran from the repository root; run `37213918933` timed out while
booting the emulator; and run `37216103307` failed before Gradle because
Bash-only `set -o pipefail` was executed via `/usr/bin/sh`. The next workflow
adds explicit ADB device/boot state, keeps ADB errors, and reports Gradle's
failure context. Release APK build, APK secret scan, and APK upload have not
passed. No V4 release or successful downloadable V4 APK exists. See
`TESTING.md` for verification limits and `BACKEND_CHANGES.md` for the additive
server contract changes.

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
| Web client regression (`npm run check`, tests, build) | run in this repository; exact output in TESTING.md §4 |
| Whole-project CI (unit tests + lint + debug APK + emulator smoke + minified release APK + APK secret scan) | Historical V1/V2/V3 runs are green; run `37219304680` passed JVM tests/lint/debug assembly but failed `:app:connectedDebugAndroidTest` without test XML or actionable ADB/Gradle diagnostics. Earlier V4 runs failed the signed-out assertion, emulator boot/setup, or working directory. Release APK, APK secret scan, and APK artifact remain unverified |
| Published APK | **yes — V3 only**: GitHub Release `apk-v3`; there is no V4 artifact yet |

**Historical runs below are baseline evidence only.** V4 has its own CI run,
but it is not green and did not produce a downloadable artifact. Even a green
APK build does **not** prove the app runs: device and live-backend behavior must
be verified separately and reported honestly.

## What changed after the first green build

A green build is not the same as working software, so the code was then read the
way a user would exercise it. Four defects were found and fixed in `e1bb05a`, none
of which any compiler or linter can see, and each now has a test or a decision
entry behind it:

1. **Offline looked like a dead gateway.** Connectivity was never consulted when
   classifying a transport failure, so `AppError.Offline` could not be produced
   and a phone with the radio off was told the server was unreachable.
   `TransportKindTest` pins the distinction (and keeps a TLS failure out of it).
2. **A share could be dropped silently.** The conversation list placed a shared
   text in a `LaunchedEffect(Unit)`, which never re-runs for a screen that is
   already composed — so sharing while looking at the list did nothing at all.
3. **A share could create two conversations.** Returning to the list with an
   assigned-but-unclaimed share re-ran the placement; it now requires
   `PendingShare.needsConversation`.
4. **A finished turn could be written twice.** `ChatTurnRunner` finalised on the
   normal path *and* again in `finally`; when the first assistant-row insert had
   failed, that second write created a second row — the same answer twice in the
   transcript. D6's "exactly once" is now enforced by a flag.

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
| 16 — Tests | JVM unit tests for the pure logic (parser, reducer, redaction, error map, time, markdown, routes, attachment size/draft store where pure) + CI assembly, lint, and API 34 emulator startup. Historical CI run `37193950163` passed the then-current suite; V4 JVM tests/lint/debug assembly pass, but run `37219304680` failed `:app:connectedDebugAndroidTest` without instrumented-test XML or actionable diagnostics. Earlier V4 runs failed the signed-out assertion, emulator boot/setup, or working directory. This phase remains in progress. | in progress |
| 17 — Report | This file plus `TESTING.md`. | done |

## What is deliberately absent

* **Voice I/O** (phase 13) — see above.
* **Direct provider routing/keys in the Android app** — the phone can submit a
  provider secret only to the authenticated backend; credentials remain
  encrypted and provider verification remains server-side. Android does not
  hold privileged keys or make direct provider calls.
* **Notifications / background push** — the backend has no push channel, so V1
  raises none and requests no notification permission.
* **Artifacts browser** — needs a download surface that is not in V1.
* **Onboarding tour** — the app explains itself where the question arises
  instead of in a carousel the user dismisses.
