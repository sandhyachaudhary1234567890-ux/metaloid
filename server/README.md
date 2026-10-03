# metaloid-gateway

Local edge/API layer for METALOID. Keys live ONLY in `server/.env`.

## Run

```bash
cd server
npm install
npm start          # http://127.0.0.1:8787
```

Frontend expects the gateway at `VITE_API_URL` (default `http://127.0.0.1:8787`,
configurable in Settings → Connections → Backend URL).

## Endpoints

- `GET /api/health` — real service state (ai/voice/vision/realtime/database)
- `GET /api/models` — live OpenRouter `:free` model list (router input)
- `POST /api/chat` — SSE `{message, history?, task?}` → `{meta, token*, done|error}`
- `POST /api/osint/investigations` + `/run` / `GET .../:id` `/findings` `/report?format=json|csv|md`

## Model routing

Live OpenRouter `:free` list → tier classify (fast/smart/vision/coding) →
per-task pick → **try-next failover** across up to 4 candidates.

A slug the provider no longer serves comes back as **HTTP 400** ("The request
contains invalid parameters"), not 404 — so 400/403/404/429/5xx all trigger the
next candidate, while 401/402 fail fast (another model will not fix a bad key
or an empty balance). Rejected slugs are **quarantined for an hour** and
flagged as `unavailable` in `GET /api/models` rather than hidden. Provider JSON
never reaches the client: the stream carries a stable code
(`no_provider · bad_key · no_credit · rate_limited · no_model · offline ·
timeout · server`) plus one human sentence.

NVIDIA fallback exists but is **off by default**: it only engages with
`NVIDIA_ENABLED=true` and an entitled key.

## Test

```bash
npm test        # 12 gateway tests against server/tests/fake-provider.mjs
```

The fake provider can fail the first N models, return 401/429, emit an empty
stream, or drop the socket — enough to prove failover, quarantine and the
error contract without touching the internet.

## Environment

| Variable | Meaning |
|---|---|
| `PORT` / `BIND_HOST` | listen address (default `8787` / `127.0.0.1`) |
| `ALLOW_ORIGINS` | comma-separated CORS allow-list (LAN origins auto-added) |
| `OPENROUTER_API_KEY` | provider key — the only thing needed to go live |
| `OPENROUTER_MODEL` | pin a preferred model (still fails over) |
| `OPENROUTER_BASE` | point at a proxy or the test fake provider |
| `PUBLIC_APP_URL` | sent as `HTTP-Referer` to the provider |
| `NVIDIA_ENABLED` / `NVIDIA_API_KEY` | optional second provider |

## Prompt layers (never one giant prompt)

Per request the gateway composes, in order:

1. `systemPrompt.js` — constitution (safety, truth, tools, memory rules)
2. `personality.js` — conversation layer (tone, answering skills)
3. Runtime context (user, datetime, honest tool manifest, memories, prefs)

Personality can never override the constitution — stated in the prompt
itself, enforced by order. Edit tone without touching safety.

## Safety rules (enforced)

- No shell execution, no CLI tools, no arbitrary commands — ever.
- Targets validated; private/internal/onion ranges rejected.
- Collector timeouts (9s), concurrency cap (3), rate limits per IP.
- Errors redacted. Keys never logged, never sent to the frontend.
- Username matches are medium-confidence **leads**, never identity proof.

## ⚠️ Key rotation

If `OPENROUTER_API_KEY` / `NVIDIA_API_KEY` were ever pasted in chat,
screenshots, or email: revoke + regenerate them at the provider dashboards,
then update `.env`. Treat pasted keys as public.
