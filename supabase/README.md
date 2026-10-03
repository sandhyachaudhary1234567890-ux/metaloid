# Supabase — identity, Postgres, storage

Supabase owns **identity, Postgres and object storage**. It holds no business
logic: model routing, provider selection, memory retrieval, agent execution and
the skill sandbox all live in the gateway (`server/`).

## The migrations are the only source of truth

`supabase/migrations/*.sql` is the schema. Apply them in filename order:

```bash
supabase link --project-ref <ref>
supabase db push              # applies supabase/migrations/*.sql, in order
```

There used to be a second, hand-maintained `supabase/schema.sql` describing the
same tables. It had drifted — `user_id text` instead of `uuid`, `provider_id`
and `encrypted_secret` instead of `provider` and `secret_ciphertext`, a
`create table` for a column set the migrations had already replaced. Two
descriptions of one schema is one description too many, so it is gone. A fresh
project created by pasting it would have produced a database the gateway could
not query. Create projects from the migrations.

Order matters only in that later files extend earlier ones; each is written to
be re-runnable.

| File | What it establishes |
| --- | --- |
| `0001_core_schema.sql` | Tables, uuid keys, foreign keys, indexes, RLS enabled **and forced** |
| `0002_rls_and_grants.sql` | Owner-only policies on every user table; grants to `authenticated`; nothing to `anon` |
| `0003_storage.sql` | Private buckets (`attachments`, `generated`, `avatars`, `artifacts`) and object policies keyed on the first path segment |
| `001_credential_audit.sql` | Credential audit trail |
| `002_text_user_ids.sql` | Widens user ids for mixed local/Supabase deployments (no-op on a Supabase-shaped project) |
| `003_credential_rotation.sql` | `provider`, `secret_ciphertext`, `label`, `key_version`, `status` on credentials |
| `004_remaining_domains.sql` | Missions, world, skills, artifacts, workspaces, devices, jobs, rate counters |
| `005_pairing_codes.sql` | Device pairing codes |
| `006_artifact_deleted.sql` | Artifact soft-delete |

Never edit an applied migration. Every change is a new numbered file.

### Applying them without the CLI

Nine files is nine paste operations, and the one you forget is the one that
matters. `bootstrap.sql` is all of them concatenated in order, so a fresh
project is one paste:

```bash
node supabase/build-bootstrap.mjs        # regenerate after editing a migration
node supabase/build-bootstrap.mjs --check # exit 1 if bootstrap.sql is stale
```

Open the project → **SQL Editor** → New query → paste `supabase/bootstrap.sql`
→ **Run**. It is idempotent: run it again after a later migration is added and
it applies only what is new.

`bootstrap.sql` is generated. Editing it directly is a change that the next
regeneration deletes, and `--check` exists so that cannot go unnoticed —
`supabase/tests/bootstrap.pglite.mjs` fails the suite when the bundle and the
migrations disagree, and also applies the bundle to a real PostgreSQL engine to
confirm every table, column, bucket and policy the gateway queries actually
exists.

## Connecting a real project, end to end

1. **Create the project**, then apply the schema with one of the two routes
   above (`supabase db push`, or paste `bootstrap.sql`).
2. **Connect it to the gateway.** Copy the values into `server/.env` (gitignored
   — never into a file that is committed, and never into anything the browser
   loads):

   | From the dashboard | Into |
   | --- | --- |
   | Project Settings → API → Project URL | `SUPABASE_URL` |
   | Project Settings → API → anon / publishable key | `SUPABASE_ANON_KEY` *(browser only, via `.env.local`)* |
   | Project Settings → API → service_role / secret key | `SUPABASE_SERVICE_ROLE_KEY` *(server only)* |
   | Project Settings → API → JWT Settings → JWKS URL | `SUPABASE_JWKS_URL` |
   | Connect → Transaction pooler | `SUPABASE_DB_POOL_URL` |

   The pooler string looks like
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres`.
   `[YOUR-PASSWORD]` is the database password you set when the project was
   created; it is not shown again and is not the same as any API key. If it is
   lost, reset it under Project Settings → Database.
3. **Generate the encryption key** and put it in `METALOID_ENCRYPTION_KEYS`:

   ```bash
   openssl rand -base64 32
   ```

   Production must use the same value, or keys saved in one environment cannot
   be decrypted in the other.
4. **Check the configuration before deploying**, without contacting anything:

   ```bash
   node server/tools/preflight.mjs --env server/.env --production
   ```

   It exits non-zero on anything that would silently lose data or serve the
   wrong thing, and separates blockers (`✖`) from warnings (`!`).
5. **Verify against the live project:**

   ```bash
   node server/tests/supabase-mode.cjs
   ```

   This is the one matrix that uses the real database; it skips with an
   explanation until `SUPABASE_DB_POOL_URL` is set.

## Verify it, don't trust it

Both checks run the real migrations against a real PostgreSQL engine and try to
break in:

```bash
node supabase/tests/rls.pglite.mjs        # 157 security properties
node supabase/tests/rls_pgtap.pglite.mjs  # pgTAP suite
node --prefix server --test server/tests/supabase-driver.test.mjs
```

The first applies every migration to Postgres-in-WASM, reconstructs the
Supabase environment (`auth.users`, `auth.uid()`, the `anon`/`authenticated`/
`service_role` roles, the storage schema), then grants `anon` and
`authenticated` **full** table privileges — the worst case a real project can
be in — so anything the probes cannot do is prevented by the policies and not
by a missing grant. Every probe runs as a non-superuser, because a superuser
bypasses RLS and would prove nothing.

## How the gateway reaches it

The gateway talks to Postgres **as the user**. Every user-scoped statement runs
inside a transaction that does:

```sql
select set_config('request.jwt.claims', '{"sub":"<verified uid>", ...}', true);
set local role authenticated;
```

Because the migrations `force row level security`, the connecting role sees
nothing without this — `auth.uid()` is null and every policy is false. Assuming
`authenticated` with the subject taken from the verified JWT makes the database
itself the access boundary. Application-level `user_id` filters are still in
every query, but they are the intent, not the protection.

Two operations legitimately run with elevated rights, both enumerated in
`server/src/data/pg.js`: account erasure (`usage_events` is append-only for the
owner by policy, yet erasure must remove it) and minting signed URLs. Both are
scoped by a mandatory `user_id = $1` predicate taken from the session.

## Production requirements

A deployment that does not set these is not durable — it will look like it
works and lose data when the instance recycles:

| Variable | Why |
| --- | --- |
| `SUPABASE_DB=supabase` | Selects the Postgres driver. Without it the gateway uses a local JSON store, which on a serverless host is `/tmp`. |
| `SUPABASE_DB_POOL_URL` | The transaction-mode pooler connection string. |
| `SUPABASE_JWT_PUBLIC_KEY` *(or `SUPABASE_JWKS_URL`, or `SUPABASE_JWT_SECRET`)* | Token verification. Nothing else counts as "auth is configured". |
| `METALOID_ENCRYPTION_KEYS` + `METALOID_ENCRYPTION_ACTIVE` | Provider keys are refused rather than stored in the clear without it (`503 encryption_unconfigured`). |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Signed URLs and object deletion. Without them uploads succeed and downloads report `storage_unavailable`. |

`GET /api/health` reports which driver is live (`data.driver`,
`storage.ready`, `encryption.configured`) rather than assuming, so a
misconfigured deployment is visible instead of merely degraded.

## What is deliberately not in Supabase

Model routing, agent execution, voice pipelines and the skill sandbox stay in
the gateway. Supabase holds identity, Postgres and storage only.
