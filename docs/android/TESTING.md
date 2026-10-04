# MetaIoid Android — testing

What is proven, how, and — just as important — what is not.

## Current V4 status (last completed CI: 2026-10-04, run `37221933634`)

V4 is **not ready to publish**. Run
[37221933634](https://github.com/sandhyachaudhary1234567890-ux/metaloid/actions/runs/37221933634)
passed JVM tests, lint, debug APK assembly, the KVM access step, and the API 34
cold-launch smoke test; the minified release APK also assembled. The APK scan
reached its separate baked-gateway-host check, but reported that the debug APK
lacked the configured host. The check piped `unzip | strings | grep -Fq` under
`pipefail`; a local reproduction on a large stream showed grep's early match
can SIGPIPE its producer and turn a real match into status 141. The next commit
changes the assertion to grep an extracted strings file, avoiding that
false-negative path. Since the step failed, APK collection/upload and the
release job did not run; no downloadable V4 APK exists yet.

The preceding run
[37220731961](https://github.com/sandhyachaudhary1234567890-ux/metaloid/actions/runs/37220731961)
failed before the smoke helper with `adb` exit 224 and no emulator log. This
resembled the KVM-permission/slow-software-emulation failure described in
[upstream issue #655](https://github.com/EranBoudjnah/CleanArchitectureForAndroid/issues/655).
With the [emulator action's documented KVM udev rule](https://github.com/ReactiveCircus/android-emulator-runner#running-hardware-accelerated-emulators-on-linux-runners)
in place, the CI step verified `/dev/kvm` was readable/writable and the smoke
step passed on the next run.
Earlier runs `37219304680` and `37217266554` had failed inside instrumentation;
the latter did not observe the signed-out screen. Production backend
compatibility, signing continuity, physical-device acceptance, and the APK
security scan/upload remain release blockers.

This environment has no Java/Gradle Android toolchain, so the Android build
results are from GitHub Actions only. Fresh checks against this tree on
2026-10-04: `npm run check` passed; `npm run build` passed;
`npm --prefix server test` passed **78/78**; and `npm run test:unit` reported
**56 passed, 1 failed**
(the pre-existing session-restoration/chat-loop test described below). The
provider HTTP matrix had previously passed **26/26**. On the same date,
`npm audit --omit=dev` and `npm --prefix server audit` reported zero
runtime/server vulnerabilities; the all-dependency root
`npm audit` still reports **10 dev-tool advisories** (3 moderate, 6 high,
1 critical), unresolved and outside the Android patch. These checks do not
verify the Android client, production deployment compatibility, signing
continuity, or behavior on a physical device.

## 1. How the app is verified

| Layer | Command | Where it runs |
| --- | --- | --- |
| JVM unit tests | `gradle :app:testDebugUnitTest` | GitHub Actions (Gradle 8.9 / JDK 17) |
| Android lint (errors fail the build) | `gradle :app:lintDebug` | GitHub Actions |
| Debug APK | `gradle :app:assembleDebug` | GitHub Actions |
| Release APK (minified + shrunk) | `gradle :app:assembleRelease` | GitHub Actions |
| Emulator startup smoke test | `gradle :app:connectedDebugAndroidTest` | GitHub Actions, API 34 emulator |
| APK secret scan | workflow step *Secret scan of the APKs* | GitHub Actions |

CI is the compiler. There is no local Android SDK in the environment these
commits were authored in, so *nothing here was compiled locally*: the first
build of every file happens on the runner. A code/test failure is treated as a
defect to investigate and fix; an infrastructure failure (such as the emulator
not booting) is not counted as a pass and must be resolved by a valid rerun.
The artifact a user installs should be the one CI built from the committed
source, with its public run retained as evidence.

## 2. Unit tests (JVM, no device)

| Test | What it pins down |
| --- | --- |
| `SseParserTest` | Incremental framing: partial lines across chunks, CRLF/bare-CR endings, multi-line `data:`, comments, `retry:`/`id:` fields, `finish()` flush, and the order of cumulative token frames. |
| `StreamEventParserTest` | Every documented `/api/chat` key → one typed event: `token`, `done` (including `done:false`), `meta` (model/tier/provider/demo/byok/notice), `error` (code + message), `retry`, unknown keys, non-JSON, and `[DONE]`. |
| `StreamReducerTest` | Cumulative replacement, the shrink anomaly, retry discarding the previous attempt, `done` with no text, terminal phases ignoring late frames, close-mid-stream vs close-before-first-token, user stop, transport loss. |
| `RedactTest` | Bearer tokens, JWTs, provider key shapes, `key=value` secrets, emails, URLs, long-message truncation. Logs and diagnostics exports are the only way a token could leave the device. |
| `ErrorMapperTest` | Every gateway code, every Supabase `error_code`, every status-only fallback, every stream code, and the transport kinds — plus a check that no user-facing message or technical detail leaks a key. |
| `TransportKindTest` | Offline versus unreachable: the same `UnknownHostException` is "offline" with no network and "unreachable" with one; a timeout stays a timeout either way; a TLS failure is never reported as offline. |
| `BackendAddressTest` | Address validation: rejects `file://`, `javascript:`, userinfo, and cleartext in a release build; normalises the trailing slash. |
| `TimeFormatTest` | Relative time, absent timestamps as `—`, clock skew, durations, byte counts. |
| `MarkdownParserTest` | Headings, lists (with depth), quotes, rules, fenced code — including an **unterminated fence**, which is what a streamed code block looks like mid-flight — and inline spans including an unclosed emphasis marker. |
| `RouteCodecTest` | The persisted navigation stack round-trips; unknown segments are dropped rather than guessed; `research` vs `researchDetail` do not collide. |
| `AuthModePreferenceTest` | Which sign-in tab a deployment gets: the head of the supported list by default, a late mode list never moving a user who already chose, and an empty list still resolving to something usable. |
| `PendingShareTest` | The shared text's waiting room: needs a conversation until one is assigned, claimable only by that conversation and only once, a blank share is ignored, a new share forgets the old conversation, and a share whose text starts with a blank line still gets a title. |

The tests are written against behaviour a user can observe, not against
implementation details: they would still pass if the internals were rewritten,
and they fail if a documented wire behaviour changes.

## 3. What lint is configured to do

`lint { abortOnError = true }`, with **no baseline file** — a baseline would hide
exactly the defects it is convenient to hide. Warnings do not fail the build;
errors do.

## 4. Web-client regression

The Android client must not require any server change, so the server's own suite
is run before every push that touches it (results recorded here at the time of
the push):

```
npm run check
npm run test:unit
npm --prefix server test
npm run build
```

### Historical web-client baseline (before the V4 backend changes)

Run in this repository on 2026-10-04, against the then-current baseline
(`246c8dd`), with Node 22.22.3 / npm 10.9.8:

| Command | Result |
|---|---|
| `npm install` | `added 430 packages in 10s` |
| `npm run check` (`tsc --noEmit`) | clean — no diagnostics |
| `npm run test:unit` (`vitest run`) | **56 passed, 1 failed** across 5 files — see below |
| `npm --prefix server test` (`node --test`) | `# tests 78 / # pass 78 / # fail 0 / # duration_ms 36329` |
| `npm run build` (`tsc -b && vite build && node scripts/build-landing.mjs`) | built in 7.57 s, then `[landing] copied landing/ → dist/ (site at /, app at /app/)` |

The one failure is **pre-existing and unrelated to the Android client**:

```
FAIL  src/App.test.tsx > chat loop > sends a message and renders the streamed reply
TestingLibraryElementError: Unable to find an element with the text: Chat.
  at src/App.test.tsx:110:32
```

`git diff --stat master...HEAD -- src package.json` is empty for the web client;
this branch does contain the V4 server contract additions documented in
`BACKEND_CHANGES.md`. The failing assertion is in the unchanged web-client test
and is unrelated to the Android/backend changes. It is not weakened, skipped or
deleted here — weakening it to make a green light would be the opposite of what
this document is for.

The historical 78/78 server result below was for the pre-V4 baseline. Against
the current V4 tree on 2026-10-04, `npm --prefix server test` passed 78/78,
the server core/artifact/skills matrices passed, and the RLS security suites
passed 157 properties plus 49 pgTAP assertions; see `BACKEND_CHANGES.md`. The
current root TypeScript check and production web build also passed, while the
root unit suite remains 56/57. This is not a complete web-client regression
pass.

## 5. What CI proves, and what is *not* verified

Green run `37193950163` (branch) / `37194219682` (tag `apk-v1`), built from
commit `3ad76ea`:

* `:app:testDebugUnitTest` — all nine test classes pass (the failure-report step
  was written precisely so that a failing assertion is readable without the log
  artifact, and it is how the two real defects below were found);
* `:app:lintDebug` — no errors, `abortOnError = true`, no baseline;
* `:app:assembleDebug` and `:app:assembleRelease` — both APKs build, the release
  one minified and shrunk;
* **Secret scan of the APKs** — no service-role key, provider key, JWT secret or
  private-key pattern in any `*.dex` or in `resources.arsc`.

Two defects were found by these runs and fixed in the code, not by weakening a
test: `SseParser` emitted a heartbeat comment as its own frame when a later
`data:` line belonged to it, and `MarkdownParser` measured list depth on an
already-trimmed line so every nested item rendered at depth 0. A third red run
was a genuinely wrong test (a 2026 timestamp compared against a January 2026
"now"); its assertion was kept and its input corrected.

What is still not verified:

* The signed-out cold-launch screen passed on the API 34 emulator in run
  `37221933634` after the KVM-permissions step. That smoke test only verifies
  startup/sign-in visibility; it does not cover chat, provider setup,
  keyboard/insets, TalkBack, or network recovery. Earlier runs `37220731961`
  and `37219304680` failed in emulator setup, and `37217266554` did not observe
  the signed-out screen.
* **The app has not been verified against the live gateway or on a physical
  device.** The emulator test did not establish that sign-in can proceed. Every
  behavior in `CONTRACT_MAP.md` is derived from server source/API documentation
  and encoded in unit tests — but "derived and unit-tested" is not "observed
  working". A compile and a unit test cannot see a wrong URL join, a missing
  capability gate, or a crash on a real device.
* **No performance numbers.** Startup time, frame timing during streaming and
  memory use are unmeasured claims until someone measures them.
* **Accessibility was designed, not audited.** Content descriptions exist for
  icon-only controls and every state has a text label beside its colour, but no
  TalkBack pass has been run.

## 6. How to run the tests locally

The repository does not include a Gradle wrapper. With JDK 17 and Gradle 8.9
installed (the same versions used by CI):

```bash
cd android
gradle :app:testDebugUnitTest          # JVM unit tests
gradle :app:lintDebug                  # lint (errors fail)
gradle :app:assembleDebug              # installable debug APK
gradle :app:connectedDebugAndroidTest  # instrumented tests (needs a device/emulator)
```

A single test:

```bash
cd android
gradle :app:testDebugUnitTest --tests 'com.metaloid.core.streaming.SseParserTest'
```

## 7. Manual smoke test (what a reviewer should try first)

1. Install the APK, open the app: the boot screen must leave as soon as the
   health check returns, and its status line must match the server's own
   `/api/health`.
2. Point it at the gateway if it is not baked in; sign in.
3. Send a message and watch: the user bubble is `Sending…` only until the server
   returns the row; the answer streams; the model name under the message is the
   one the server reported.
4. Press stop mid-answer: the partial text stays, labelled `Stopped`, and
   re-opening the conversation shows the same text from the server.
5. Kill the app mid-answer and re-open: the turn appears as interrupted, closed
   by the server's `recover`, with its partial text intact.
6. Turn off the network while browsing: the app says offline; previously loaded
   conversations still open, labelled as cached.
