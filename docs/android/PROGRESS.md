# MetaIoid Android — progress

**Honesty rule for this file:** a phase is marked done only when the code is
committed *and* CI has compiled it *and* its tests pass. Until then it is
"written, unverified". No phase is ever marked done because it looks finished.

Last updated: 2026-10-04, at commit `2185498` — the commit whose CI run
(`37196373156` on the branch, `37196994498` on the tag) is green and which the
published release `apk-v3` was built from. `apk-v2` (`e1bb05a`) and `apk-v1`
(`3ad76ea`) are earlier builds of the same project.

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
| Whole-project CI (unit tests + lint + debug APK + minified release APK + APK secret scan + "the baked default gateway is really in the APK") | **green**: `37193950163`, `37195121775`, `37196373156` (branch), `37194219682`, `37195469014`, `37196994498` (tags) |
| Default gateway baked in | `https://metaloid.vercel.app` — a fresh install connects to the live backend and only asks for a sign-in |
| Published APK | **yes** — GitHub Release `apk-v3` (latest), built from `2185498` |

**What that green run does and does not prove.** It proves the project compiles
with no errors, the nine JVM test classes pass, `lintDebug` reports no errors
with `abortOnError = true`, both APKs assemble (release minified and shrunk), and
neither APK contains a privileged-secret pattern.

It does **not** prove the app runs: nothing here has executed on a device or
against a live gateway. `docs/android/TESTING.md` §5 lists precisely what
remains unverified, and no claim in these documents goes beyond that.

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

## What changed after `apk-v2`

Read the second time against two questions: "does the logo look like MetaIoid?"
and "can a person who has never seen this app use it?" Five more defects, in
`e375381` and `2185498`:

5. **The logo was invisible in two places.** The brand asset is black ink on
   transparency. The launcher icon put it on the near-black page colour (a black
   mark on a black square, in the launcher, the task switcher and the Android 12
   splash) and the in-app boot/sign-in marks were drawn untinted on the obsidian
   page. The plate is now white — the brand's original pairing — and `BrandMark`
   tints the painter with the theme's foreground, which is what the web client's
   `dark:invert` does (D23).
6. **The app did not know where the backend was.** A fresh install asked the user
   to type a server address. The deployment URL is now baked into the APK as a
   public build value, and CI fails if that string is not inside both artifacts
   (RELEASE.md §3).
7. **A new user on a Supabase-backed deployment could not sign in.** The sign-in
   screen read the identity-provider configuration once, before `/api/config` had
   answered, and then offered the handle-and-passcode tab and nothing else — a
   form that cannot work on a deployment whose accounts live in Supabase. The
   config is now observed and the default is decided by `AuthModePreference`,
   with tests, without ever overriding a tab the user picked (D24).
8. **The back button closed the app from every screen.** `back()` existed with no
   caller; a `BackHandler` now walks the app's own route stack and is disabled at
   the root (D25).
9. **The R8 keeps named the wrong package.** `proguard-rules.pro` kept
   `com.metaloid.app.MetaIoidApplication` / `MainActivity`, which is the
   `BuildConfig`/`R` namespace rather than where those classes live; the share
   receiver had no rule at all. All three manifest components are now kept by
   their real names.

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
| 16 — Tests | JVM unit tests for the pure logic (parser, reducer, redaction, error map, time, markdown, routes, attachment size/draft store where pure) + CI assembly and lint. CI run `37193950163` passed all of it; the two defects CI's first red runs found (SSE comment buffering, Markdown list depth) are fixed by tests, not by weakening them. | done |
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
