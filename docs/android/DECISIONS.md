# MetaIoid Android — decisions

Every non-obvious choice, why it was made, and what it costs. Decisions that
affect the server are in `BACKEND_CHANGES.md`; this file is client-side.

## D1 — Hand-rolled navigation instead of `navigation-compose`

The graph is eleven destinations and flat. `navigation-compose` would add a
dependency, a route-string DSL and a second source of truth for what a route
*is*. Instead: a sealed `Route`, a `List<Route>` back stack in `AppViewModel`,
and `when (route)` — which the compiler checks for exhaustiveness, so adding a
destination without a screen is a build error rather than a blank page in QA.

Cost: no deep-link graph beyond the two intent extras the share flow needs, and
no per-destination result plumbing. Acceptable for V1; revisit if deep links
arrive.

## D2 — No dependency injection framework

`AppContainer` is ~200 lines of constructor calls. Hilt/Koin would add a compiler
plugin, generated code and a build step to replace it. The layering rule the
container exists to enforce — *a feature never constructs its own dependencies* —
is checkable by reading one file.

Cost: adding a dependency means editing the container. That is the point.

## D3 — Hand-rolled Markdown renderer

The shapes that matter for assistant prose are headings, lists, fenced code,
inline code, emphasis, links, quotes and rules. A CommonMark engine is large, and
— more importantly — would re-parse the entire message on every streamed token.
`MarkdownParser` is a single pass, is memoised per message text by the caller,
and is designed for **partial** input: an unterminated fence renders as a code
block, because that is what a streaming code block is.

Cost: no tables, no nested block quotes, no reference links. If the models start
emitting tables regularly, this is the first thing to replace.

## D4 — Cumulative tokens, replaced rather than appended

`/api/chat` sends the whole text so far in every `token` frame. The reducer
**replaces** the buffer. Appending would duplicate the entire answer on the
second frame.

The one interesting case: a token *shorter* than what is held. That is legitimate
immediately after a `retry` frame (the server discarded the previous attempt) and
an anomaly otherwise — in which case the longer text is kept and the anomaly
counted, because losing text the user already read is worse than a stale tail.
`supersededText` holds a discarded attempt so nothing is silently deleted.

## D5 — The assistant row is created at the first token, not before

`POST …/messages` rejects empty content, so a placeholder row is impossible.
Creating the row at the first token means:

* no empty assistant bubble can exist, in the app or on the server;
* a killed process leaves a `streaming` row that the server's own `recover`
  endpoint closes as `cancelled`/`interrupted` — **with the partial text**, which
  was already on the server;
* a failure before the first token leaves no trace server-side, which is correct:
  there was no answer.

Cost: the assistant row does not exist while the model is "thinking", so a
conversation opened on another device during that window shows nothing yet. That
is the honest state.

## D6 — The turn finalises exactly once, under `NonCancellable`

`ChatTurnRunner` wraps the turn in `try/finally`; the `finally` block runs the
finalisation in `withContext(NonCancellable)`. Pressing Stop, navigating away or
a scope cancellation therefore still writes the terminal status. Any other design
leaves rows stuck in `streaming` — the failure mode that makes a transcript lie
about a turn that is over.

## D7 — No automatic retry of a turn

A retry is a user decision. An automatic retry after a partial answer can double
a provider charge and can duplicate a message. The app retries exactly one thing
automatically: a 401 with a token it still holds triggers one refresh and one
retry. `retryOnConnectionFailure(false)` is set on the OkHttp client for the same
reason — OkHttp's silent retry can replay a POST.

## D8 — 75-second inactivity abort

The gateway sends `: ping` every 8 seconds, and the server caps upstream calls at
50 seconds. A client that waits forever on a dead socket is indistinguishable
from a slow model, so the transport aborts after 75 seconds of *complete* silence
— long enough for any legitimate gap, short enough that the user gets an answer
about what happened. The socket read timeout is disabled for the stream, because
a read timeout cannot tell a quiet stream from a dead one; a watchdog that sees
the heartbeat can.

## D9 — The conversation cache exists, and is never authoritative

Reads show the cache only when the network fails, and they say so with the age of
the copy. Writes never go to the cache first. This is the rule that keeps a
transcript from showing something the server does not have.

## D10 — Drafts are per conversation and survive process death

The draft is the only thing the user typed that the server has never seen, so it
is the only thing that must survive a crash. Writes are debounced (~400 ms) and
the draft is cleared on a confirmed send — **not** on a failed one, which is when
it matters most.

## D11 — A share pre-fills the composer; it never sends

Tapping "share" selects a recipient; it is not consent to speak. The shared text
becomes an unsent draft in a real (server-created) conversation. The user decides
whether to send it, and can edit it first.

## D12 — Attachments are hidden unless the deployment can store them

`uploadsAvailable()` is true only when the server reports writable storage *and*
the session can authorise a storage write (a Supabase token). Otherwise the
attach control is absent and Settings says why. Offering a button that produces
`storage_unavailable` is worse than not offering it.

## D13 — Files upload as the user, with the user's token

The object upload uses the session's Supabase access token over the public
storage API. No service-role key exists anywhere in the app, the build, or
`local.properties`; the release checklist greps the APK to prove it. The upload
key is the server-provided path (`{user_id}/{file_id}/{filename}`), never
reconstructed client-side from the filename.

## D14 — Provider keys are not managed from the phone in V1

The gateway supports it, but the phone is the device most likely to be lost, and
a key-management screen would mean a key passes through the app's memory (and
risk) for no added capability. Keys stay on the web client. Recorded as a scope
decision, not an oversight.

## D15 — Voice is not in this build

The gateway reports `voice: false` on this deployment, and the client shows voice
as unavailable rather than offering a control that cannot work. The device-side
recogniser path (no audio leaves the phone) is designed in
`docs/ANDROID_API.md` terms but is the first item of the next increment: shipping
it would require a microphone permission flow, a partial-result composer and a
test pass on real hardware that this build has not had.

Consequently the manifest declares **no** `RECORD_AUDIO` permission and no
speech-service `<queries>`: an install dialog that asks for the microphone in an
app with no voice feature is a false statement about what the app does. The
`AppError.VoiceUnavailable` type and the voice preference keys exist for the next
increment; nothing in this build reads them.

## D16 — The design tokens are transcribed, not re-invented

`Tokens.kt` is a direct transcription of `src/design/tokens.ts`,
`src/index.css` and `src/design/motion.ts`, including the awkward parts: the
surface ladder, the two accents per brand colour (a luminous one for text, a deep
one for fills — one value cannot do both legibly), the 4/8 spacing rhythm, and
the motion easings.

Android-specific adaptations, with reasons:

| Web | Android | Why |
| --- | --- | --- |
| `px` type sizes | the same numbers as `sp` | dynamic font scaling must scale everything; pinning text to a fixed pixel size breaks large-text users |
| CSS `cubic-bezier` | `CubicBezierEasing` | identical curves, so the app and the web client *feel* the same |
| `prefers-reduced-motion` | same toggle, plus an explicit override in Settings | Android's animator duration scale is not reliably visible to an app; an in-app override is honest and testable |
| hover states | pressed states only | there is no pointer; hover tokens exist but are unused |
| system font stack | the platform default + monospace for code | Inter/Manrope are loaded from the network on web and are not in this repository; bundling them would add ~400 KB of font files for a first release that must stay small. Recorded as a known visual difference. |

## D17 — One accent per screen, depth from surface value

From the design system's own rules: never a pure-black page, no glass, no
shadows for hierarchy. Depth is surface value plus hairline borders, and exactly
one accent colour is in play on any screen. The accent is used for the single
primary action and for "live" states — never as decoration.

## D18 — Status is derived, never stored

The status line has exactly five states (checking, live, degraded, offline,
sandbox) and each is computed from a real observation: the last `/api/health`
result, the device's connectivity, and the `demo` flag the server sent for the
answer in flight. There is no timer that flips anything to "connected", and no
retry that hides a failure.

## D19 — Colours never carry meaning alone

Every state that has a colour also has a word: "Stopped", "Interrupted",
"failed · upload failed", "refusing every few seconds". This is an accessibility
requirement and also the reason the UI is readable in a screenshot.

## D20 — The diagnostics screen is redacted at the boundary

`MetaLog` passes every line through `Redact`, which strips bearer tokens, JWTs,
provider key shapes, emails and URL queries *on the way in*. The screen therefore
cannot leak a token, and "copy diagnostics" is safe to paste into an issue. This
is why redaction is a property of the logging layer rather than a habit at call
sites.

## D21 — Release build: minified, shrunk, and signed with what exists

`isMinifyEnabled = true`, `isShrinkResources = true`, and a ProGuard rules file
that keeps only what reflection needs (kotlinx.serialization generated
serializers). Signing uses the repository's debug key unless a real keystore is
supplied through CI secrets — documented in `RELEASE.md`, and stated in the
release notes so nobody mistakes the artifact for a store-ready build.

## D22 — Cleartext is refused outside debug

The release manifest sets `usesCleartextTraffic="false"` and a network security
config that trusts only the system CAs. A debug build gets an explicit config
that allows cleartext (for a laptop gateway on the LAN) and nothing else. The
address validator refuses `http://` in a release build at entry time, so the
failure is a sentence the user can act on instead of a TLS error later.
