# Supabase setup — STATUS: CONNECTED (project `dqtewpjxngpmvvljnpvx`, Tokyo)

Live state: `schema.sql` + migrations `001`, `002`, `003` applied; catalog
seeded (5 providers, 9 models); RLS verified (anon reads catalog, 0 user
rows); gateway accepts Supabase JWTs (`sb:` namespace) end-to-end.

`SUPABASE_DB=supabase` routes credentials/audit, usage metering, and
memories to Postgres. Profiles/plans, missions, world, skills, artifacts,
workspaces stay file-based (next migration block). Switching modes migrates
content with new ids — never silent.

## 1. Create the project

1. https://supabase.com/dashboard → New project (any region close to users)
2. Note: Project URL + `anon` key + `service_role` key

## 2. Apply the schema

```bash
# from C:\metaloid
supabase link --project-ref <ref>   # or paste schema.sql in SQL editor
supabase db push                     # applies supabase/schema.sql
```

Verify: Table Editor shows profiles/conversations/messages/… with RLS enabled.

## 3. Configure Auth (Dashboard → Authentication)

- Enable Email provider; set Site URL to the frontend origin
- Auth → Rate limits: review signup/login/reset limits for launch traffic
- Auth → Email: built-in sending is very low-volume; configure custom SMTP
  (or another email provider) before any real user launch
- Enable email confirmations + password recovery templates

## 4. Storage (Dashboard → Storage)

- Create private buckets: `attachments`, `artifacts`, `renders`
- Policies: owner-only read/write via `auth.uid()` folder prefix
  (`<uid>/…`); use signed URLs with short expiry for downloads
- Set per-file size limits + allowed MIME lists per bucket

## 5. Wire the gateway (env — NEVER commit values)

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon>        # client-safe only
SUPABASE_SERVICE_ROLE_KEY=<key> # server env ONLY, never frontend/APK/repo
SUPABASE_DB_POOL_URL=postgresql://postgres.<ref>:<pw>@<pool-host>:6543/postgres?pgbouncer=true
```

Recommended: transaction pooling (pgbouncer :6543) for API traffic;
direct connection only for long-lived migration/admin work.

## 6. Code migration map (when wiring)

| Current (file stores)      | Supabase target                          |
|----------------------------|------------------------------------------|
| users.js sessions          | Supabase Auth (JWT → user id per request) |
| profiles.json              | profiles                                 |
| conversations (client)     | conversations + messages (paginated)     |
| credentialVault            | user_provider_credentials (owner RLS)    |
| entitlements usage         | usage_events (append-only + aggregates)  |
| memory.json                | memories (scoped, relevance-ranked reads) |
| missions.json              | agent_tasks + tool_events                |
| artifacts bytes            | Storage buckets; rows → metadata only    |
| observe counters           | usage_events + Postgres aggregates       |

Identity rule (unchanged): every server op derives user id from the
verified JWT — never from client-provided ids. Current Bearer-session
code stays as the local-dev auth path.

## 7. Backups / recovery

- Paid plans: enable daily backups + point-in-time recovery; test a
  restore to a staging project before launch
- Keep `supabase/schema.sql` as the reproducible source of truth;
  every later change = new numbered migration file

## 8. What is deliberately NOT in Supabase

Model routing, agent execution, voice pipelines, skill sandbox — these
stay in the MetaIoid API/worker layer (separately scalable). Supabase
holds identity + Postgres + storage only.
