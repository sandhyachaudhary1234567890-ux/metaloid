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
per-task pick → **try-next failover** (dead slug 404 / rate-limit 429 walk
up to 3 candidates). NVIDIA fallback exists but is **off by default**: it
only engages with `NVIDIA_ENABLED=true` and an entitled key (an unentitled
key 404s every model, which previously produced misleading failures).

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
