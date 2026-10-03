# METALOID — test matrix and failure classification

`npm test` runs everything below that can run without external services. The
suites that need a live provider account or a Supabase project are listed
separately, with the reason, so a red result is never mistaken for a product
bug — and never hidden.

## What `npm test` runs

| Step | Command | What it proves |
|---|---|---|
| Typecheck | `npm run check` | the whole app compiles under `strict` |
| Unit | `npm run test:unit` (vitest) | app contracts: transport, auth, repo, stores |
| Integration | `npm run test:integration` | gateway API over real HTTP with the real local data driver, then the domain matrices |
| Security | `npm run test:security` | RLS executed in PGlite (157 properties) + the pgTAP suite (49 assertions) |
| End-to-end | `npm run test:e2e` | signup → login → onboarding → provider → models → chat stream → memory → logout → login → data persists, plus cross-user isolation and CORS |

Domain matrices inside `test:integration` (`npm --prefix server run test:matrices`):

* `core-isolation.mjs` — accounts, sessions, memory, missions, world, OSINT,
  profiles, entitlements, workspaces/devices: every read is scoped to the
  authenticated user, and deletion cascades.
* `artifacts-matrix.mjs` — real .pptx/.docx bytes, OpenXML validation, version
  history, cross-user isolation, filename traversal blocks, renderer honesty
  (it reports "structurally validated, not visually rendered" when no renderer
  is installed), the ToolRegistry bridge and skill-dependency resolution.
* `skills-matrix.mjs`, `skills-v2.mjs` — skill packages, sandbox escape probes,
  project scope, versioning/rollback/audit, discovery quality and the
  1000-skill benchmark budget.
* `intent-artifact-matrix.mjs` — a natural-language request selects a verified
  writer and produces a real file that is re-opened and checked.

## Failures found and fixed during the release merge

These were real defects on the master line, caught by running its own suites —
not by deleting assertions:

| Defect | Impact | Fix |
|---|---|---|
| `server/src/core/supadb.js` declared `msnRecover()` twice | ESM SyntaxError: **every Supabase-mode import died** | duplicate removed, import verified |
| `server/src/tools/catalog.js` called the async artifact API without `await` (13 sites) | `presentation.create`, `artifact.*` and other tools returned `{ok:false,error:"Error"}` | every call awaited; a tool now produces a real .pptx |
| `server/src/core/artifacts.js::deleteUserArtifacts` referenced an undefined `mine` | account deletion crashed and left files behind | derives the user's artifacts before unlinking |
| `server/src/core/skillInitiatives.js::proposeFollowups` used async `discoverFor` synchronously | mission completion crashed instead of proposing follow-ups | awaited |
| Stale sync calls to now-async APIs in the matrices, and Windows-only paths (`C:\metaloid`, `spawn('node')`) | tests could not run at all on Linux/CI | awaits added; repo-relative cwd and `process.execPath` |

## Suites that need external services (`npm --prefix server run test:matrices:network`)

| Suite | Requirement | Classification |
|---|---|---|
| `providers-matrix.mjs` | live provider accounts | PASSES when the network allows it (60 s); hangs without egress → ENVIRONMENTAL |
| `providers-http.cjs`, `http-matrix.cjs` | gateway + fake provider HTTP | runnable locally; kept out of the default run so a missing port cannot mask a product failure |
| `load.cjs` | local gateway | local driver measurements only — never quoted as capacity by this repo (see `docs/loadtest-local.json`) |
| `supabase-mode.cjs` | a real Supabase project with data (env from `server/.env`) | ENVIRONMENTAL: needs a live project; its hardcoded Windows path was fixed so it runs from any checkout |

Nothing above is skipped silently: a suite that needs a service says so, and
the default run stays green without pretending it covered them.
