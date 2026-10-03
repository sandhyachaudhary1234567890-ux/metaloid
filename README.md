# METALOID

**A private personal AI operating system.** One loop, end to end:

> open → ask → think → answer → speak / show / tool → memory / history

Voice, vision, agent missions, a memory vault and a model router behind one
calm surface. The gateway holds the keys; the browser never sees them.

```
┌ site ────────────────┐   ┌ product ─────────────┐   ┌ gateway ─────────────┐
│ /  landing page      │ → │ /app/  the assistant │ → │ :8787  /api + SSE    │
└──────────────────────┘   └──────────────────────┘   └──────────┬───────────┘
                                                                 │
                                                    OpenRouter / NVIDIA /
                                                    sandbox provider
```

---

## Quickstart — the whole product in two minutes

```bash
npm install
cd server && npm install && cd ..

npm run showcase      # → http://localhost:5173
```

`showcase` starts three things: a **sandbox provider** (streams real SSE tokens
locally, no key, no network), the **gateway**, and the **app**. The full loop —
streaming replies, missions, memory, voice mode — works immediately.

The sidebar shows **SANDBOX**, not ONLINE. That is the point: the app never
pretends. Set a real key and it flips to **ONLINE** with live models.

### Live models

Create `server/.env`:

```ini
OPENROUTER_API_KEY=sk-or-...
ALLOW_ORIGINS=http://localhost:5173
BIND_HOST=127.0.0.1
```

```bash
npm run gateway       # :8787
npm run dev           # :5173  (landing at /, product at /app/)
```

Optional: `OPENROUTER_MODEL` pins a preferred model, `OPENROUTER_BASE` points
at a compatible proxy or a local fake.

---

## Four real states, never a fake green dot

Most assistants show a green light whatever is happening. METALOID has four
distinct, truthful states, and the UI switches between them automatically:

| State | Meaning | What the user sees |
|---|---|---|
| **ONLINE** | a live provider answered | real model output |
| **SANDBOX** | a local/sandbox provider is serving | working demo, clearly labelled |
| **DEGRADED** | a key is set but unreachable | told the truth instead of silence |
| **LOCAL DEMO** | no gateway at all | in-browser engine, every message marked demo |

`GET /api/health` reports the same thing, from facts:

```json
{ "ai": true, "provider": "openrouter", "models": { "free": 41, "catalogue": true } }
```

`ai` is only true when a key is present **and** the provider actually answered
the catalogue call — never because a variable is set.

---

## What is inside

| Layer | Where | What it does |
|---|---|---|
| Experience | `src/screens`, `src/components` | Home · Chat · Live · Memory · History · Settings |
| Local agent runtime | `src/lib/agent`, `src/lib/voice`, `src/lib/skills` | planning, checkpoints, quality metrics, barge-in voice loop, skill forge |
| Transport | `src/lib/transport.ts` | the only file that touches the network; relative URLs + scheme rescue |
| Gateway | `server/src/index.js` | CORS lock, rate limits, SSE, hardening, graceful drain |
| Agent kernel | `server/src/core` | missions, permissions, verification, memory, world model, audit |
| Model router | `server/src/openrouter.js` | task routing, failover, dead-slug quarantine, honest errors |
| Skills & tools | `server/src/skills`, `server/src/tools` | OSINT collectors, research helpers, tool catalogue |

Deeper documents: [`ARCHITECTURE.md`](ARCHITECTURE.md) ·
[`VOICE_ARCHITECTURE.md`](VOICE_ARCHITECTURE.md) ·
[`voicetest/RESULTS.md`](voicetest/RESULTS.md)

---

## Reliability, because free models churn

The bug that shaped this layer: a free model slug that the provider no longer
serves does **not** return 404. It returns **HTTP 400 — "The request contains
invalid parameters"** — and that raw sentence used to land in the user's face.

Now:

- **every** model rejection (`400 / 403 / 404 / 429 / 5xx`) fails over to the
  next candidate inside the same stream;
- a rejected slug is **quarantined for an hour** and never retried — the second
  question does not pay for the first one's dead model;
- `401 / 402` fail **fast** — a bad key or an empty balance is not fixed by
  trying another model;
- SSE-level errors and silent empty streams count as failures, not successes;
- the user gets one calm sentence plus a stable code
  (`no_provider · bad_key · no_credit · rate_limited · no_model · offline ·
  timeout · server`); provider JSON stays in the server log;
- `/api/models` **flags** quarantined slugs instead of hiding them, so the
  model picker can explain itself.

## Tests

```bash
npm test          # typecheck + 44 tests (app + gateway)
```

- **32 app tests** (vitest + jsdom): transport contract, the four connection
  states, every screen rendering (including Live with no camera), a full chat
  round-trip with stubbed SSE, and the voice segmenter — including the
  Devanagari danda regression that once stopped Hindi from being spoken.
- **12 gateway tests** (node:test) against `server/tests/fake-provider.mjs`, a
  controllable provider that can fail the first N models, return 401/429, emit
  an empty stream or drop the socket — so failover, quarantine and error
  honesty are proven, not asserted.

```bash
npm run test:app        # frontend only
npm run test:server     # gateway only
npm run test:server -- --watch
```

---

## Deploy

**Site + app → Vercel** (root `/` is the landing page, `/app/` the product —
`vercel.json` handles the rewrites and asset caching):

```
VITE_API_URL = https://<your-gateway-host>   # set before the first build
```

**Gateway → Render / Railway / Fly** (it must be a persistent process:
in-memory missions, OSINT jobs, long SSE streams — it cannot be serverless):

| Variable | Value |
|---|---|
| `BIND_HOST` | `0.0.0.0` |
| `ALLOW_ORIGINS` | `https://<your-site>` |
| `OPENROUTER_API_KEY` | your key (**rotate anything ever pasted in chat**) |
| `NVIDIA_ENABLED` | `false` unless the account is entitled |

Health check: `GET /api/health` → `ai: true`. `render.yaml` is a blueprint.

### Same-Wi-Fi phone testing

Both servers can serve TLS from `certs/` (generate with
`cd server && node certs-gen.mjs`), which is what unlocks mic capture on a
phone. Details and firewall notes: [`server/README.md`](server/README.md).

---

## Security posture

- provider keys live only in the gateway's environment, never in the bundle;
- the gateway binds `127.0.0.1` by default and the showcase keeps it loopback —
  an auth-less API fronting paid keys must not sit on the open internet;
- CORS is an explicit allow-list (the machine's own LAN origins are added
  automatically for phone testing, never `*`);
- the gateway sets `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  a `Permissions-Policy`, and `no-store` on every `/api/` response;
- input caps on every route (message length, body size), per-IP rate limits,
  unhandled-rejection armour, and a graceful drain on SIGTERM;
- nothing secret is ever logged, and `server/src/core/memory.js` redacts
  key-shaped strings before they can be stored as memories.

## Layout

```
landing/               marketing page (served at /)
src/                   the product (served at /app/)
  lib/transport.ts     the only network layer
  lib/voice/           streaming voice loop
server/                gateway (Express + SSE)
  src/openrouter.js    model router, failover, quarantine
  tests/               gateway tests + fake provider
scripts/showcase.mjs   one-command demo
```

## Status

Working today: streaming chat with failover · voice loop with barge-in ·
vision path · missions with approvals and checkpoints · OSINT investigations
with reports · memory vault with redaction · model router and picker · landing
page · 30 tests · deploy-ready build.

Deliberately still local-first: history and memories are browser storage until
you point the app at a server database. Provider keys are yours; nothing is
proxied through anyone else.
