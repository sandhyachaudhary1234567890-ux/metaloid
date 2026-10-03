# MetaIoid Peak Audit — Product Surface Follow-up

This is a product-path audit after the existing architectural audits. It records observed, testable state rather than feature claims.

| Subsystem | Best working path | Main weakness | Action in this pass |
| --- | --- | --- | --- |
| Chat + streaming | Authenticated SSE chat with stop/cancel and event activity | Offline mode remains explicitly a demo | Preserved the honesty banner and event flow |
| Artifacts | Server creates, validates and serves authenticated file bytes | Artifact discovery was only available from a chat message | Added Library route with live listing and real open/download |
| Workspaces | User-scoped `/api/workspaces` CRUD | No primary screen exposed it | Added Projects route with fetch/create/empty/error states |
| Missions | Server-backed mission create/run/pause/cancel/checkpointing | Accessible only through a side panel | Added Tasks route with actual list and run actions |
| Research | OSINT investigation runtime | Buried in the tools drawer | Added Research route that opens the backed investigation surface |
| Activity | `ActivityStateEngine` consumes real events | Home reported fictional subsystem readiness | Home now renders the canonical event activity only |
| Tool discovery | Drawer previously included placeholders and prompt-only “tools” | Controls implied execution that did not occur | Removed unsupported entries; retained only connected launchers |
| Navigation | Six-screen shell hid several shipped APIs | Product felt like a prototype despite real services | Promoted the four backed workspaces and made advanced routes secondary |

## Evidence

- `npm run check` passed on 2026-09-22.
- `npm run build` passed on 2026-09-22.
- Gateway suites passed: artifact pipeline, cross-user isolation, HTTP authorization, provider adapters, provider HTTP boundaries, skills, and skills-v2.
- Build warning retained: the primary JavaScript bundle is 890.75 kB minified; `BlackHoleCanvas` is separately lazy-loaded at 492.27 kB. This is a performance follow-up, not a claim of completion.

## Known limitations

- Rendered browser QA was not completed in this environment: the existing local preview endpoint refused the browser connection, and its configured preview uses a self-signed HTTPS certificate that the automated browser must not bypass. Typecheck and production build did complete.
- The workspace API currently models files as metadata, so project upload must not be presented as durable storage.
- Browser-local memory and gateway memory have separate paths; merging them needs an explicit migration/sync policy.
- The standalone root TypeScript test scripts cannot run directly under Node on this host because their extensionless TypeScript imports are not resolved by Node's ESM loader. `server/test/contextFabric.test.js` additionally fails to parse before running: `server/src/core/contextFabricIntegration.js:504` uses `await import` in a non-`async` function. The provider-security test passes.
- The repository contains pre-existing changed and untracked work outside this product surface pass; it was left untouched.
