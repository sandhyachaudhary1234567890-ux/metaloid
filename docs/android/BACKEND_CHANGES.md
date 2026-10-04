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

The full Android build, Android unit tests, lint, APK secret scan, installation,
launch, and device behavior are **not yet verified**. Do not use
`METAIOID V4 — MARKET READY` or publish an APK release until the Android CI
workflow is green and the stated device/release checks have actually been run.
