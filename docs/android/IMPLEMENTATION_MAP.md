# MetaIoid Android — implementation map

Where each thing lives. Every path is under `android/app/src/main/java/com/metaloid/`
unless stated otherwise.

## Package layout

```
com.metaloid
├── MetaIoidApplication.kt      Application: builds the container, installs the
│                               crash logger (redacted) and re-throws to the
│                               platform handler.
├── MainActivity.kt             The only Activity. Edge-to-edge, one ViewModel,
│                               intent handling, setContent. No logic.
├── app/                        The shell: theme, launch gate, session gate,
│   ├── MetaIoidApp.kt          route host, bottom bar, shared top bar.
│   ├── AppViewModel.kt         preferences, auth state, observed system status,
│   │                           capability set, navigation stack.
│   ├── Route.kt                Sealed destinations + hand-written codec for the
│   │                           persisted back stack.
│   └── SystemSnapshot.kt       (in AppViewModel.kt) status + capabilities.
├── core/
│   ├── common/                 MetaLog (redacted ring buffer), Redact,
│   │                           AppDispatchers, AppError (typed failures with
│   │                           user-facing messages and one action each).
│   ├── backend/                BackendAddress: validate/normalise the gateway URL.
│   ├── designsystem/           Tokens, Motion, Theme (Material 3 mapping),
│   │                           MetaIcons, Components (buttons, banners, states,
│   │                           status dot, skeletons, spinners).
│   ├── network/                ApiContracts (envelopes + ErrorMapper),
│   │                           HttpEngine (clients + interceptors + redacting
│   │                           logger), ApiClient (the only HTTP entry point).
│   ├── session/                Session/SessionStore, AuthApis (gateway +
│   │                           Supabase), SessionManager (one refresh at a
│   │                           time, offline ≠ signed out).
│   ├── storage/                SecureVault (Keystore AES/GCM), PreferencesStore
│   │                           (DataStore), DraftStore (per-conversation).
│   ├── streaming/              SseParser, StreamEvent + parser, StreamTransport
│   │                           (OkHttp, watchdog, cancellation).
│   ├── share/                  PendingShare: the shared text's waiting room.
│   ├── system/                 ConnectivityMonitor (network presence only).
│   └── ui/                     Markdown renderer, TimeFormat, the feature
│                               ViewModel factory helper.
├── data/
│   ├── dto/                    Wire types, `@SerialName`-mapped. No logic.
│   ├── api/                    MetaIoidApi (gateway + /api/v1), SupabaseAuthClient.
│   └── repo/                   ConversationsRepository (list, transcript, cache,
│                               recover), AttachmentsRepository (picker → record
│                               → upload → confirm).
├── di/AppContainer.kt          The object graph, in one file.
└── feature/
    ├── boot/                   BootScreen: brand, real status line, no timer.
    ├── auth/                   AuthViewModel + SignInScreen (gateway or Supabase,
    │                           plus the gateway-address dialog).
    ├── chat/                   ChatViewModel, ChatScreen, ChatModels (UI message
    │                           + state vocabulary), domain/StreamReducer,
    │                           data/ChatTurnRunner (the turn's persistence order).
    ├── conversations/          List ViewModel + screen (search, rename, delete,
    │                           cached-with-age, share intake).
    ├── library/                The thin read-mostly ViewModels (memory, missions,
    │                           research, activity, usage) — one file, because
    │                           they are the same shape.
    ├── memory/                 MemoryScreen.
    ├── missions/               MissionsScreen + MissionDetailScreen.
    ├── research/               ResearchScreen + ResearchDetailScreen.
    ├── activity/               ActivityScreen (jobs).
    ├── usage/                  UsageScreen (summary + rows).
    ├── settings/               SettingsScreen (account, appearance, links).
    ├── diagnostics/            DiagnosticsScreen (capabilities, health, redacted log).
    └── share/                  ShareReceiverActivity (text/plain intake).
```

## Data flow in one line per layer

* **UI** (`feature/**/…Screen.kt`) renders state and forwards intents. No
  networking, no parsing, no policy.
* **ViewModel** (`feature/**/…ViewModel.kt`) holds immutable `UiState`, calls
  repositories, applies the pure reducer to stream events.
* **Repository** (`data/repo`, `feature/chat/data`) decides *order* (store user →
  stream → create row → finalise) and never throws: failures are `ApiResult.Err`
  carrying a typed `AppError`.
* **API** (`data/api`) maps one endpoint to one typed result; identity comes from
  the token, never from a parameter.
* **Transport** (`core/network`, `core/streaming`) owns HTTP, retry policy,
  refresh coordination, SSE framing and cancellation.

## Where each required behaviour lives

| Behaviour | File |
| --- | --- |
| Cumulative token semantics | `feature/chat/domain/StreamReducer.kt` |
| SSE framing (LF/CRLF/CR, comments, multi-line data) | `core/streaming/SseParser.kt` |
| Frame → event mapping | `core/streaming/StreamEvent.kt` |
| 75 s inactivity abort, cancel-closes-socket | `core/streaming/StreamTransport.kt` |
| Turn persistence order, single finalisation | `feature/chat/data/ChatTurnRunner.kt` |
| Interrupted-turn recovery (`…/messages/recover`) | `data/repo/ConversationsRepository.kt` |
| One refresh at a time; offline ≠ signed out | `core/session/SessionManager.kt` |
| Token/key/PII redaction | `core/common/Redact.kt` (applied in `MetaLog`) |
| Error vocabulary and messages | `core/common/AppError.kt` + `ErrorMapper` in `core/network/ApiContracts.kt` |
| Capability gating (files, voice, research) | `app/AppViewModel.kt` (`Capabilities`) |
| Design tokens | `core/designsystem/Tokens.kt` |
| Motion, with the reduced-motion override | `core/designsystem/Motion.kt`, `Theme.kt` |
| Upload progress from real bytes | `data/repo/AttachmentsRepository.kt` |
| Draft survival | `core/storage/DraftStore.kt` |
| Persisted navigation stack | `app/Route.kt` (`RouteCodec`) + `PreferencesStore` |
| Share intake | `feature/share/ShareReceiverActivity.kt` + `core/share/PendingShare.kt` |

## Build layer

| File | Purpose |
| --- | --- |
| `android/settings.gradle.kts`, `build.gradle.kts` | Plugin management, repositories, module list. |
| `android/gradle/libs.versions.toml` | Pinned versions, with a justification line for each third-party entry. |
| `android/app/build.gradle.kts` | SDK levels, minify/shrink for release, lint with `abortOnError`, public-only build config. |
| `android/app/proguard-rules.pro` | Keep rules for kotlinx.serialization; strip logs in release. |
| `android/app/src/main/AndroidManifest.xml` | Three permissions, two Activities, cleartext refused. |
| `android/app/src/main/res/**` | Brand colours, window themes, adaptive icon, brand art, strings for a11y labels. |
| `android/tools/generate-icons.mjs` | Regenerates the launcher mipmaps from `public/brand/metaloid-mark.png`. |
| `.github/workflows/android.yml` | The only Android compiler: tests, lint, debug + release APKs, artifacts, optional release. |

## Test layout

`android/app/src/test/java/com/metaloid/…` — JVM tests, mirroring the package
they test: `core/streaming/{SseParserTest,StreamEventParserTest}`,
`feature/chat/domain/StreamReducerTest`, `core/common/RedactTest`,
`core/network/{ErrorMapperTest,TransportKindTest}`, `core/backend/BackendAddressTest`,
`core/share/PendingShareTest`, `core/session/AuthModePreferenceTest`,
`core/ui/{TimeFormatTest,MarkdownParserTest}`, `app/RouteCodecTest`.
