# Metaloid deployment — variables + commands

## Local (current dev path)

```bash
# Gateway + frontend (ports 8787 / 5173, self-signed LAN certs)
node server/src/index.js
npm run dev
```

Env (`server/.env`, never committed — see `server/.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no (8787) | gateway port |
| `BIND_HOST` | no (127.0.0.1) | `0.0.0.0` = LAN reachable |
| `OPENROUTER_API_KEY` | for AI | platform model key |
| `NVIDIA_API_KEY` + `NVIDIA_ENABLED=true` | no | only with entitled key |
| `ALLOW_ORIGINS` | no | extra CORS origins (comma list) |
| `METALOID_DATA_DIR` | no | data dir override (tests) |
| `METALOID_ACCESS_TTL_MS` | no | session TTL override (tests) |
| `METALOID_AUTH_LIMIT` | no | auth rate-limit override (tests) |
| `METALOID_JOB_CONCURRENCY` | no (4) | background job cap |
| `SUPABASE_DB` | no (`files`) | `supabase` = Postgres for credentials/audit/usage/memories (others stay files) |
| `METALOID_CREDENTIAL_KEY` | no (ephemeral) | **set in production** — AES master key; rotating it orphans stored credentials |

## Current production path (verified files)

- Frontend → Vercel: `vercel.json` (Vite). Set `VITE_API_URL=https://<gateway-url>`.
- Gateway → Render: `render.yaml` (Node, `/api/health` check). Set
  `OPENROUTER_API_KEY`, `ALLOW_ORIGINS=https://<vercel-app>`.

## Health

- `GET /api/health` — component state (public, no auth required)
- `GET /api/ready` — 200 only when process + writable data dir + provider
  registry all OK; load balancers should gate on `/ready`, not `/health`

## Supabase path (not connected yet)

See `supabase/README.md`. Additional env when wired:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(server only), `SUPABASE_DB_POOL_URL` (transaction mode).

## Operational notes

- Rate limits are per-user when authed, per-IP otherwise; auth endpoints
  are the strictest (`METALOID_AUTH_LIMIT`, default 10/min).
- Long work (missions, investigations) runs in the bounded jobs queue
  (`/api/jobs`, `/api/jobs/:id`); chat streams and never waits on jobs.
- Logs: `[req] <id> <method> <path> <status> <ms> user=<id>` — no secrets.
  Correlate incidents by `X-Request-ID` response header.
- Cost protection: BYOK providers run first only when the user connected
  them; platform free models are the fallback; budgets gate chat/missions/
  OSINT per plan. No silent paid spend: invalid keys fail loudly with
  reconnect guidance.
