# METALOID Architecture Specification v1.0

For the engineering team. Status: **V1 implemented** in this repo (markers below);
everything else is specified with its seam already in place.

Principle: **deterministic code decides, the model reasons.**
Permissions, state transitions, schemas, validation, audit, queues → code.
Interpretation, planning, language, synthesis → model (under constitution).

---

## 1. SYSTEM ARCHITECTURE

```
┌────────────────────────────────────────────────────────┐
│ EXPERIENCE LAYER (V1 ✓) web app                        │
│ Home · Chat · Live · Memory · History · Settings       │
│ + contextual surfaces: ToolsDrawer · OsintPanel ·      │
│   MissionsPanel · VoiceMode · CommandPalette           │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP + SSE  (VITE_API_URL)
┌──────────────────────────▼─────────────────────────────┐
│ EDGE / GATEWAY (V1 ✓) server/src/index.js              │
│ CORS lock · rate limits · timeouts · redacted errors   │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ AGENT KERNEL (V1 ✓) server/src/core/agent.js           │
│ classifyIntent → planMission → skill discovery →       │
│ run → synthesize → verify → memory/world update        │
└──────┬──────────┬───────────┬────────────┬─────────────┘
       │          │           │            │
┌──────▼───┐ ┌────▼────┐ ┌────▼─────┐ ┌────▼──────────┐
│ MODEL    │ │ SKILL   │ │ TOOL     │ │ MEMORY/WORLD  │
│ ROUTER   │ │ RUNTIME │ │ FABRIC   │ │ + CONTEXT     │
│ (V1 ✓)   │ │ (V1 ✓)  │ │ (V1 ✓)   │ │ (V1 ✓ file)   │
└──────┬───┘ └────┬────┘ └────┬─────┘ └───────────────┘
       │          │           │
┌──────▼──────────▼───────────▼──────────────────────────┐
│ EXECUTION RUNTIME (V1 ✓ missions.js: budgets, retries, │
│ checkpoints, pause/resume/cancel) + PERMISSIONS (V1 ✓) │
│ + VERIFICATION (V1 ✓) + OBSERVABILITY (V1 ✓)           │
└────────────────────────────────────────────────────────┘
```

## 2. COMPONENT DIAGRAM

| Component | File | Purpose |
|---|---|---|
| Gateway | `server/src/index.js` | routes, gates, streams |
| Model router | `server/src/openrouter.js` | free-list, classify, pick, stream/complete |
| NVIDIA fallback | `server/src/nvidia.js` | smart-tier overflow |
| Constitution | `server/src/systemPrompt.js` | v2.0 + runtime templating |
| Agent kernel | `server/src/core/agent.js` | intent → mission → synthesis |
| Missions | `server/src/core/missions.js` | persistent task graphs |
| Skills | `server/src/core/skills.js` + `skills/` | manifests + discovery |
| Tools | `server/src/core/tools.js` + `tools/` | registry + gated execution |
| Permissions | `server/src/core/permissions.js` | risk ladder + approvals |
| Verification | `server/src/core/verify.js` | checks + status vocabulary |
| Memory | `server/src/core/memory.js` | 5 classes, file-backed |
| World | `server/src/core/world.js` | entities + relations graph |
| Events/audit | `server/src/core/events.js` | bus + 500-ring audit |
| Observe | `server/src/core/observe.js` | counters, latency, models |
| OSINT collectors | `server/src/osint.js` | crt.sh, DoH, GitHub, jobs |
| OSINT skill | `server/src/skills/osintSkill.js` | resolution + ingestion |
| Research skill | `server/src/skills/researchSkill.js` | wiki + correlate |
| Frontend store | `src/store/` | session/library/chat slices |
| Transport | `src/lib/transport.ts` | sole network boundary |

## 3. DATA FLOW

```
user text
 → chat intent gate (osint|mission|continue → panels; else LLM)
 → context pack (memories ≤12, prefs, history ≤10)
 → POST /api/chat {message,history,context}
 → tier classify → pick free model → stream SSE → UI tokens
 → autoSpeak? TTS : idle
```

Mission flow: `POST /api/agent/mission` → plan → `runMission` (levels, ≤3 parallel,
retry×1, budgets) → tool evidence → `complete()` synthesis → `verify()` →
COMPLETED→VERIFIED → poll UI.

## 4. AGENT FLOW

`OBSERVE → UNDERSTAND → DECOMPOSE → PLAN → EXECUTE → VERIFY → REPORT → LEARN`
implemented as: intent regex → `discoverSkills` → `planMission` (depIdx graph) →
`runMission` levels → evidence digest → model report → `verify` checks →
`attachReport` → timeline/audit. LEARN = memory/world writes (explicit tools only).

## 5. SKILL RUNTIME DESIGN

Manifest: `{id,name,description,capabilities,tools,inputSchema,outputSchema,
securityLevel,executionPolicy,verificationPolicy,planTemplate,keywords,version}`.
Discovery: deterministic keyword rank (no model). Only briefs enter context.
Add a skill = new file + `defineSkill` (no core edits). Current: `osint`,
`research`. Next: `coding` (sandboxed exec), `files`, `browser` (MCP).

## 6. OSINT ARCHITECTURE

Orchestrator: `osint.js` jobs (queued→collecting→normalizing→correlating→
complete|partial|failed) + `osintSkill.js` (resolution/ingestion).
Modules today: CT/subdomain, DNS, GitHub footprint, correlation, timeline,
reporting (JSON/CSV/MD). News/geo/ASN/document modules: specified, keyless
sources identified (GDELT, USGS, OpenSky public feeds) — Phase 2.
Boundaries enforced: passive only, target validation, private-range rejection,
username leads ≤ medium, TruffleHog refused by default.

## 7. MEMORY ARCHITECTURE

Classes: working (task-local, mission.outputs), episodic (timelines/audit),
semantic (user facts), procedural (skill templates — code, not rows),
mission (checkpoints). Record: `{id,class,content,source,at,confidence,scope,
lastVerified}`. Pollution guards: secret-shaped writes refused + audited;
unverified content capped at medium. Server file store (`server/data/`,
gitignored); frontend localStorage stays the personal-memory home until sync lands.

## 8. WORLD MODEL

`USER → GOALS → PROJECTS → TASKS → TOOLS → RESULTS → LEARNING` as
entities/relations with `{rel,source,confidence,evidence,at}` edges.
Resolution levels MATCHED/PROBABLE/POSSIBLE/UNRELATED; merge only on MATCHED.
OSINT findings ingest via `POST .../ingest`. Query: `GET /api/world/graph?id&depth`.

## 9. TOOL FABRIC

Schema per tool: name/purpose/inputs{type,required,max,pattern}/outputs/
risk/timeout/verify/tags/sideEffects. Pipeline: discover → authorize →
validate → race timeout → audit → verify flag. Add tool = `defineTool`
(no core edits). MCP-compatible shape reserved: `{name,inputSchema,handler}`
maps 1:1 to an MCP tool definition (Phase 2 bridge).

## 10. EXECUTION RUNTIME

Read/reversible run inline; external/irreversible queue approvals
(`GET/POST /api/approvals`). No shell/eval/child-process anywhere (grep-guaranteed).
Budgets per mission (120s/25 steps). Sandbox for code exec = Phase 2
(isolated worker + no network).

## 11. SECURITY MODEL

Identity: single local user (auth lands with multi-device). Authorization:
risk ladder + approval queue. Secrets: `.env` only, never logged/sent
(redaction by construction — no key touches a response path). Network: bind
127.0.0.1, CORS allowlist, rate limits, 9–15s collector timeouts, 256kb bodies.
Audit: security.* + mission.* + tool.* rings. Kill switch: stop gateway
process (Phase 2: `/api/admin/halt` + run-token).

## 12. VERIFICATION ENGINE

Checks: `nonempty`, `no-placeholders`, `provenance-present`,
`no-absolute-identity` (+ custom via `defineCheck`). Status vocabulary
PLANNED/ATTEMPTED/FAILED/BLOCKED/COMPLETED/VERIFIED enforced in missions;
UI mirrors the same words. Critic: `POST /api/agent/criticize`.

## 13. MULTI-AGENT DESIGN

V1: single kernel + skill-scoped execution (no agent sprawl). Reserved:
role prompts (researcher/coder/critic/verifier) as `complete()` calls with
role system slices, coordinated by the kernel, sharing mission state.
Rule: spawn a sub-role only when its verification improves the outcome.

## 14. MISSION ENGINE

See `core/missions.js`: ids, objectives, constraints, priority, dep graphs,
parallel levels (3), retry×1, budgets, pause/resume/cancel, crash recovery
(RUNNING→QUEUED with note), file persistence, synthesis+verify→VERIFIED.
Frontend: `MissionsPanel` + `mission:` / `continue` intents.

## 15. DATABASE / STORAGE DESIGN

V1: JSON files (`server/data/*.json`, capped sizes) + browser localStorage.
V1.5: SQLite (better-sql: missions, findings, memory, audit, FTS) — same
module APIs, swap persistence functions only. Vector recall: Phase 3
(sqlite-vec or pgvector) — not needed before memory volume demands it.

## 16. API DESIGN

REST + SSE, all under `/api`: `health, models, chat(SSE), skills(+/discover),
tools(+/discover), approvals, missions(+/run/pause/cancel/verify/active),
agent/(mission|continue|criticize|intent), memory, world/(entities|relate|graph|resolve),
verify, research/correlate, osint/(investigations…|collectors), debug/summary`.
Errors: `{error}` redacted. Streaming: `data: {meta|token|done|error}`.

## 17. EVENT SYSTEM

`core/events.js`: `emit(type,payload)`, `on(type,fn)`, wildcard `*`,
500-ring audit for `security.*|mission.*|tool.*`. Debug reads audit tail.
Phase 2: WebSocket fan-out for live mission progress (polling today).

## 18. QUEUE / JOB SYSTEM

V1: in-process promise workers (OSINT ≤3 concurrent; missions ≤3/level),
process-memory job maps, crash re-queue. V1.5: persistent queue table +
worker with lease + retries/backoff (same `runMission` core).

## 19. OBSERVABILITY

`core/observe.js`: event counters, tool ok/failed/denied, approvals,
model calls (provider/model/tier/ms/ok), latency p50/p95.
`GET /api/debug/summary` (+ world/memory stats + audit tail).
Evals (Phase 2): `server/src/eval/` benchmark missions (factuality,
anti-sycophancy probe set, OSINT precision, recovery drill) with score history.

## 20. EVALUATION FRAMEWORK

(Phase 2, seams ready) Benchmarks: identity/capability-honesty probes,
sycophancy traps ("just agree"), OSINT precision/recall on known domains,
mission recovery (kill mid-run → continue), verification strictness.
Store runs in SQLite; gate releases on deltas, never on absolute scores alone.

## 21. FRONTEND / UX ARCHITECTURE

6 views only; intelligence surfaces are contextual (drawers/panels), never
routes. Animation communicates state (orb states, streaming cursor,
waveform, scan, skeletons). Chat intents route to runtime (`investigate`,
`mission:`, `continue`). Honesty invariants: connection pill, DEMO tags,
provenance on findings, confidence ≠ truth copy. Motion: 180/300/550ms.

## 22. FOLDER / REPOSITORY STRUCTURE

```
C:\metaloid
├─ src/{lib,store,components,screens,hooks}   # experience layer
├─ server/
│  ├─ src/{index,openrouter,nvidia,systemPrompt,osint}.js
│  ├─ src/core/{events,permissions,tools,skills,missions,agent,
│  │             memory,world,verify,observe}.js
│  ├─ src/{tools/catalog.js,skills/osintSkill.js,skills/researchSkill.js}
│  ├─ data/ (gitignored runtime state)
│  └─ .env (gitignored secrets)
├─ ARCHITECTURE.md  (this file)
└─ README.md
```

## 23. TECH STACK

V1: Node 20+ + Express (gateway), vanilla ESM modules (zero framework lock),
React+Vite+Tailwind (experience), JSON files (state). Why: runs anywhere,
debuggable, no build step for the brain. V1.5: +SQLite, +WebSocket, +vitest.
God-tier: Postgres+pgvector, Redis queue, OTel, k8s. Model-agnostic by
construction (router + OpenAI-compatible shims); tool-agnostic (registry).

## 24. LOCAL DEVELOPMENT

```
cd server && npm install && npm start   # :8787 (needs .env keys)
npm run dev                              # :5173 (repo root, separate shell)
```
Health: `/api/health` (ai:true = keys+models OK). Debug: `/api/debug/summary`.
Reset runtime state: delete `server/data/`. Bypass intro: `?no-intro`.

## 25. PRODUCTION DEPLOYMENT

Not yet: add auth (token), TLS termination, CORS tightening, SQLite, log
shipping, systemd/docker, secret manager (never `.env` files), per-user
namespaces, cost caps per mission. Current bind (127.0.0.1) is intentionally
local-only.

## 26. MVP (built ✓)

Chat on free-model router + constitution + memory grounding; OSINT
investigations with provenance; missions with real tool tasks + verified
reports; permissions/approvals skeleton; file persistence; debug surface;
6-view UI + 3 contextual panels; honest offline demo.

## 27. PHASE 2

SQLite, WebSocket progress, coding skill (sandboxed exec + tests),
browser/search provider, MCP bridge, prompt-caching, eval harness,
auth + multi-device, proactive engine (opt-in monitors).

## 28. PHASE 3

Vector recall, planner with cost/latency optimizer, sub-role agents,
geospatial + news intelligence modules, mobile/desktop shells,
continuous evaluation gates.

## 29. FUTURE GOD-TIER

Self-improving skill synthesis (verified, sandboxed, human-approved),
cross-device world-model sync with E2E encryption, formal verification
hooks for irreversible actions, open skill marketplace with signed manifests.

---

## Component contract template (applies to every module above)

PURPOSE (one line) · INPUTS (schema) · OUTPUTS (schema) · DEPENDENCIES
(imports) · SECURITY (risk level, gates) · FAILURE MODES (timeout, invalid
input, provider down → fallback/error) · VERIFICATION (checks) · SCALING
(stateless handlers → horizontal; file stores → SQLite).
