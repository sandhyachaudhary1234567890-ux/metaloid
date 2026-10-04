# Backend changes for MetaIoid Android V4

This Android increment uses the existing authenticated V1 account credential
store and the existing provider adapter routes. It makes additive changes to
provider metadata and message finalisation so Android can show backend-listed
models and preserve the actual model/provider after a server failover.

These changes are source-only until deployed. No production backend behavior is
claimed from local test results.

## 1. Additive server changes

| Change | Files | Compatibility |
|---|---|---|
| `GET /api/providers` includes backend-declared `authType` and `pricingUrl` | `server/src/index.js` | Optional response fields; old clients ignore them. The mobile key form offers only adapters with supported secret auth types. |
| Provider model rows preserve `free`, `pricing`, and `unavailable` metadata; OpenRouter live rows are marked free and checked against quarantine | `server/src/index.js`, `server/src/core/providerRegistry.js`, `server/src/core/providerAdapter.js`, `server/src/core/modelCatalog.js` | Optional fields; unknown pricing remains null, not a claim of free service. |
| Model refresh accepts capability lists and capability maps | `server/src/index.js` | Existing provider adapters remain compatible. |
| `PATCH /api/v1/messages/:id` accepts bounded nullable `model` and `provider` updates | `server/src/data/index.js`, `server/src/data/pg.js` | Additive. The chat runner uses it to replace stale attempt metadata after a `retry` frame. |

The V4 client still sends provider secrets only to the authenticated
`/api/v1/provider/credentials/:provider` write, which refuses storage when
server-side encryption is unconfigured. The credential vault and adapter test
remain server-owned; Android stores neither keys nor a local verification
verdict.

## 2. Contract tests added

`server/tests/api-v1.test.mjs` now verifies that a streamed assistant row can be
patched with a fallback answer/model and can clear stale provider metadata, then
be recovered as an interrupted row. The existing account/credential isolation
and encryption tests remain in that suite.

## 3. Verification status (2026-10-04)

Verified locally:

* `npm test --prefix server` — 78 tests passed, 0 failed (run after installing
  both root and server dependencies so the PGlite-backed Postgres tests are
  available).
* `node --test server/tests/api-v1.test.mjs` — 15 tests passed, including the
  message fallback metadata assertions.
* `node server/tests/providers-http.cjs` — 26 provider HTTP/auth-isolation
  checks passed, including backend-declared auth/pricing metadata and explicit
  unknown-pricing preservation for model rows.
* `npm --prefix server run test:matrices` — core isolation, artifact, and skill
  matrices all passed.
* `npm run test:security` — 157 RLS properties plus 49 pgTAP assertions passed.

Production deployment check: a live `GET https://metaloid.vercel.app/api/health`
returned `build = 384c82ccddc33884a9369918b88554307cdbf479` at 2026-10-04
15:28 UTC. The V4 additive server changes are in `ce0a83b`, after that build.
The health endpoint reports healthy services, but it does **not** prove the
current provider metadata or nullable message-PATCH contract is deployed. A
public `GET /api/models` returned 17 live entries with `provider=openrouter`,
`free_only=true`, and `mock=false`; that verifies the public model feed only.
Authenticated provider metadata/settings and message PATCH compatibility remain
unverified. Production backend compatibility is therefore a release blocker
until the deployment is updated and those routes are verified. No deployment
was attempted here.

Android CI run `37211404025` passed JVM unit tests, lint, and the debug APK
build; its API 34 startup instrumentation test failed to reach the expected
signed-out screen. The release APK build and secret scan were skipped. V4 has
not been installed on a physical device; V3/V4 signing continuity and
performance/accessibility audits are also outstanding. Do not use
`METAIOID V4 — MARKET READY` or publish an APK release until the CI, deployed
backend, signing, and device release gates are actually satisfied.
