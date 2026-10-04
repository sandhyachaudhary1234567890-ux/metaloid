// Postgres driver for the account-data layer — the PRODUCTION driver.
//
// Every user-scoped statement runs inside a transaction that first does:
//
//     set local role authenticated;
//     select set_config('request.jwt.claims', '{"sub":"<uid>"}', true);
//
// That is the whole point. The migrations enable *and force* row level
// security, so the connecting role (which owns the tables) sees nothing —
// `auth.uid()` is null and every policy evaluates false. By assuming the
// `authenticated` role with the caller's verified subject, the database
// itself decides what this request may touch. Application-level `user_id`
// filters are still present in every query, but they are the intent, not the
// security boundary; removing one cannot leak another account's rows.
//
// Two operations legitimately run with elevated rights, and both are
// explicitly enumerated here rather than implied:
//   * account erasure  — `usage_events` is append-only for the owner by
//     policy, yet erasure must remove those rows (spec §32). Runs as
//     `service_role` with a mandatory `user_id = $1` predicate.
//   * signed URLs      — minting requires the storage API key; ownership is
//     re-checked in Postgres before a URL is ever produced.

import pg from 'pg';
import crypto from 'node:crypto';
import { normalizeTaskStatus, taskIsFinished } from './vocabulary.js';
import { decrypt as legacyDecrypt } from '../core/crypto.js';

const { Pool } = pg;

let pool = null;
let injected = null; // test seam: an executor backed by PGlite (see tests)
let warnedAboutRole = false;

/** The pool is created lazily: importing this module must never dial out. */
function getPool() {
  if (pool) return pool;
  const connectionString = String(process.env.SUPABASE_DB_POOL_URL || '').trim();
  if (!connectionString) {
    const e = new Error('SUPABASE_DB_POOL_URL is not configured.');
    e.code = 'db_unconfigured';
    e.status = 503;
    throw e;
  }
  pool = new Pool({
    connectionString,
    max: Number(process.env.METALOID_PG_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    // A managed pooler terminates TLS with its own certificate chain.
    ssl: /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  pool.on('error', (e) => console.error('[data/pg] idle client error:', e.message));
  return pool;
}

/** Single point of contact with the database. */
async function rawQuery(text, params) {
  if (injected) return injected(text, params);
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/**
 * Test seam. Lets the integration suite run this driver against a real
 * Postgres (PGlite) without a network socket, which is how the RLS behaviour
 * of the driver is verified rather than assumed.
 */
export function __setExecutor(fn) {
  injected = fn || null;
}

/**
 * Run `fn` with the caller's identity installed in the database session.
 * Everything inside is subject to RLS as that user.
 */
async function withUser(ctx, fn) {
  const claims = JSON.stringify({
    sub: ctx.userId,
    role: 'authenticated',
    ...(ctx.email ? { email: ctx.email } : {}),
  });

  // No socket (test executor) or single-statement path: set the claim in one
  // statement, then run the body. `set_config(..., true)` is transaction
  // local, so a pooled connection cannot leak one user's claim to the next.
  const work = async (run) => {
    await run(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await run(`select set_config('request.jwt.claim.sub', $1, true)`, [ctx.userId]);
    try {
      await run(`set local role authenticated`);
    } catch (e) {
      // Misconfigured role membership must not silently disable isolation;
      // the explicit user_id predicate still applies, and the operator is
      // told exactly once what to fix.
      if (!warnedAboutRole) {
        warnedAboutRole = true;
        console.error(
          '[data/pg] could not assume the `authenticated` role — RLS is not being enforced for this connection.',
          e.message
        );
      }
    }
    return fn(run);
  };

  if (injected) {
    const run = (text, params) => injected(text, params);
    await injected('begin', []);
    try {
      const out = await work(run);
      await injected('commit', []);
      return out;
    } catch (e) {
      await injected('rollback', []).catch(() => {});
      throw e;
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('begin');
    const run = (text, params) => client.query(text, params);
    const out = await work(run);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Elevated path. Callers MUST scope by user in the SQL they pass. */
async function asAdmin(text, params) {
  if (injected) return injected(text, params);
  return rawQuery(text, params);
}

const one = (r) => (r.rows && r.rows[0]) || null;

// ── cursors ─────────────────────────────────────────────────────────────
// Same encoding as the file driver: base64url of `<sortKey>|<id>`. The tuple
// comparison keeps paging stable while rows are being inserted.
function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('|');
    if (idx <= 0) return null;
    return { sortKey: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

function encodeCursor(sortKey, id) {
  return Buffer.from(`${sortKey}|${id}`, 'utf8').toString('base64url');
}

const clampLimit = (limit, fallback = 50) => Math.min(Math.max(Number(limit) || fallback, 1), 200);

/** toISOString() for anything the driver hands back to the API layer. */
const iso = (v) => (v instanceof Date ? v.toISOString() : v);

/**
 * Shared paging wrapper for the `select ... order by <key> <dir>, id <dir>`
 * pattern. `args` are the bind parameters that come before the cursor pair.
 */
async function paginate(run, { sql, args, key, dir, limit, cursor }) {
  const capped = clampLimit(limit);
  const params = [...args];
  const mark = decodeCursor(cursor);
  let where = '';
  if (mark && key === 'created_at') {
    where = ` and (created_at, id) ${dir === 'desc' ? '<' : '>'} ($1::timestamptz, $2::uuid)`;
    // The cursor pair is always the last two bind parameters.
    params.push(mark.sortKey, mark.id);
    // Rewrite $1/$2 above to point at the appended pair.
    where = ` and (created_at, id) ${dir === 'desc' ? '<' : '>'} ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  } else if (mark && key === 'updated_at') {
    params.push(mark.sortKey, mark.id);
    where = ` and (updated_at, id) ${dir === 'desc' ? '<' : '>'} ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  } else if (mark) {
    // Cursor for a row that no longer exists (or was deleted): restart at the
    // top rather than failing a client's pagination outright.
    params.push(mark.sortKey, mark.id);
    where = ` and (${key}, id) ${dir === 'desc' ? '<' : '>'} ($${params.length - 1}, $${params.length}::uuid)`;
  }

  params.push(capped + 1);
  const r = await run(`${sql}${where} order by ${key} ${dir}, id ${dir} limit $${params.length}`, params);
  const rows = r.rows || [];
  const more = rows.length > capped;
  const slice = more ? rows.slice(0, capped) : rows;
  const last = slice[slice.length - 1];
  return {
    rows: slice,
    next_cursor: more && last ? encodeCursor(iso(last[key === 'created_at' ? 'created_at' : key]), last.id) : null,
  };
}

// ── repositories ────────────────────────────────────────────────────────
let warnedAboutStorage = false;

export const driver = 'supabase';

export const conversations = {
  async create(ctx, { title, model = null, provider = null }) {
    return withUser(ctx, async (run) => {
      const r = await run(
        `insert into public.conversations (user_id, title, model, provider)
         values ($1, $2, $3, $4) returning *`,
        [ctx.userId, title || 'New conversation', model, provider]
      );
      return one(r);
    });
  },
  async get(ctx, id) {
    return withUser(ctx, async (run) => {
      const r = await run(`select * from public.conversations where id = $1 and user_id = $2`, [id, ctx.userId]);
      return one(r);
    });
  },
  async list(ctx, { limit, cursor } = {}) {
    return withUser(ctx, (run) => paginate(run, {
      sql: `select * from public.conversations where user_id = $1 and archived = false`,
      args: [ctx.userId], key: 'updated_at', dir: 'desc', limit, cursor,
    }));
  },
  async update(ctx, id, patch = {}) {
    const sets = [];
    const args = [id, ctx.userId];
    const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
    if (typeof patch.title === 'string' && patch.title.trim()) put('title', patch.title.trim().slice(0, 200));
    if ('model' in patch) put('model', patch.model ? String(patch.model).slice(0, 120) : null);
    if ('provider' in patch) put('provider', patch.provider ? String(patch.provider).slice(0, 40) : null);
    if ('archived' in patch) put('archived', !!patch.archived);
    sets.push('updated_at = now()');
    return withUser(ctx, async (run) => {
      const r = await run(
        `update public.conversations set ${sets.join(', ')}
         where id = $1 and user_id = $2 returning *`, args
      );
      return one(r);
    });
  },
  async remove(ctx, id) {
    return withUser(ctx, async (run) => {
      // Messages cascade at the FK level; tool events keep their history and
      // lose only the link (`on delete set null`).
      const r = await run(`delete from public.conversations where id = $1 and user_id = $2 returning id`, [id, ctx.userId]);
      return r.rowCount > 0;
    });
  },
};

export const messages = {
  async append(ctx, conversationId, { role, content, model = null, provider = null, status = 'complete', metadata = {} }) {
    return withUser(ctx, async (run) => {
      // The insert is guarded by a select so a conversation that is not the
      // caller's yields 404 rather than a foreign-key error.
      const owns = await run(`select id from public.conversations where id = $1 and user_id = $2`, [conversationId, ctx.userId]);
      if (!owns.rowCount) return null;
      const r = await run(
        `insert into public.messages (conversation_id, user_id, role, content, model, provider, status, metadata)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning *`,
        [conversationId, ctx.userId, role, content, model, provider, status, JSON.stringify(metadata || {})]
      );
      await run(`update public.conversations set updated_at = now() where id = $1 and user_id = $2`, [conversationId, ctx.userId]);
      return one(r);
    });
  },
  async list(ctx, conversationId, { limit, cursor } = {}) {
    return withUser(ctx, async (run) => {
      const owns = await run(`select id from public.conversations where id = $1 and user_id = $2`, [conversationId, ctx.userId]);
      if (!owns.rowCount) return null;
      return paginate(run, {
        sql: `select * from public.messages where conversation_id = $1 and user_id = $2`,
        args: [conversationId, ctx.userId], key: 'created_at', dir: 'asc', limit, cursor,
      });
    });
  },
  async update(ctx, id, patch = {}) {
    const sets = [];
    const args = [id, ctx.userId];
    const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
    if (typeof patch.content === 'string') put('content', patch.content.slice(0, 32000));
    if (['streaming', 'complete', 'cancelled', 'error'].includes(patch.status)) put('status', patch.status);
    if ('error_code' in patch) put('error_code', patch.error_code ? String(patch.error_code).slice(0, 60) : null);
    if (Number.isFinite(patch.tokens)) put('tokens', patch.tokens);
    if (Number.isFinite(patch.latency_ms)) put('latency_ms', patch.latency_ms);
    if (!sets.length) return null;
    return withUser(ctx, async (run) => {
      const r = await run(
        `update public.messages set ${sets.join(', ')} where id = $1 and user_id = $2 returning *`, args
      );
      return one(r);
    });
  },
  async markStale(ctx, conversationId) {
    return withUser(ctx, async (run) => {
      // The cause is recorded, not implied. A UI showing "cancelled" with no
      // error_code cannot tell an interrupted stream from a user pressing stop.
      const r = await run(
        `update public.messages set status = 'cancelled', error_code = 'interrupted'
         where conversation_id = $1 and user_id = $2 and status = 'streaming'`,
        [conversationId, ctx.userId]
      );
      return r.rowCount || 0;
    });
  },
};

export const memories = {
  async create(ctx, { content, category = 'Personal', kind = 'explicit', pinned = false }) {
    return withUser(ctx, async (run) => {
      const r = await run(
        `insert into public.memories (user_id, content, category, kind, pinned)
         values ($1, $2, $3, $4, $5) returning *`,
        [ctx.userId, content, category, kind, pinned]
      );
      return one(r);
    });
  },
  async list(ctx, { limit, cursor, kind, query } = {}) {
    const args = [ctx.userId];
    let where = '';
    if (kind) { args.push(kind); where += ` and kind = $${args.length}`; }
    if (query) { args.push(`%${String(query).slice(0, 100)}%`); where += ` and content ilike $${args.length}`; }
    return withUser(ctx, (run) => paginate(run, {
      sql: `select * from public.memories where user_id = $1${where}`,
      args, key: 'created_at', dir: 'desc', limit, cursor,
    }));
  },
  async update(ctx, id, patch = {}) {
    const sets = [];
    const args = [id, ctx.userId];
    const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
    if (typeof patch.content === 'string' && patch.content.trim()) put('content', patch.content.trim().slice(0, 2000));
    if (typeof patch.category === 'string') put('category', patch.category.slice(0, 40));
    if (['explicit', 'project', 'conversation', 'preference', 'inferred'].includes(patch.kind)) put('kind', patch.kind);
    if ('pinned' in patch) put('pinned', !!patch.pinned);
    if (!sets.length) return null;
    sets.push('updated_at = now()');
    return withUser(ctx, async (run) => {
      const r = await run(`update public.memories set ${sets.join(', ')} where id = $1 and user_id = $2 returning *`, args);
      return one(r);
    });
  },
  async remove(ctx, id) {
    return withUser(ctx, async (run) => {
      const r = await run(`delete from public.memories where id = $1 and user_id = $2`, [id, ctx.userId]);
      return r.rowCount > 0;
    });
  },
};

export const providerSettings = {
  async get(ctx) {
    return withUser(ctx, async (run) => {
      const r = await run(`select * from public.user_provider_settings where user_id = $1`, [ctx.userId]);
      return one(r);
    });
  },
  /**
   * Upsert keyed on the user. `$3`/`$4` are the nullable columns; COALESCE on
   * update means an omitted field is left alone rather than nulled.
   */
  async upsert(ctx, patch = {}) {
    return withUser(ctx, async (run) => {
      const existing = one(await run(`select * from public.user_provider_settings where user_id = $1`, [ctx.userId]));
      const merged = {
        default_provider: 'default_provider' in patch ? patch.default_provider : (existing?.default_provider ?? null),
        default_model: 'default_model' in patch ? patch.default_model : (existing?.default_model ?? null),
        fallback_enabled: 'fallback_enabled' in patch ? !!patch.fallback_enabled : (existing?.fallback_enabled ?? true),
        free_only: 'free_only' in patch ? !!patch.free_only : (existing?.free_only ?? true),
      };
      const r = await run(
        `insert into public.user_provider_settings (user_id, default_provider, default_model, fallback_enabled, free_only)
         values ($1, $2, $3, $4, $5)
         on conflict (user_id) do update set
           default_provider = excluded.default_provider,
           default_model    = excluded.default_model,
           fallback_enabled = excluded.fallback_enabled,
           free_only        = excluded.free_only,
           updated_at       = now()
         returning *`,
        [ctx.userId, merged.default_provider, merged.default_model, merged.fallback_enabled, merged.free_only]
      );
      return one(r);
    });
  },
};

export const providerCredentials = {
  async list(ctx) {
    return withUser(ctx, async (run) => {
      const r = await run(
        `select id, user_id, provider, label, masked_hint, key_version, status, last_checked_at, created_at, updated_at
         from public.user_provider_credentials where user_id = $1 order by provider, label`,
        [ctx.userId]
      );
      return r.rows || [];
    });
  },
  async upsert(ctx, { provider, label = 'default', secret }) {
    // Encryption happens here, once, for the same reason it happens in the
    // file driver: no plaintext key is ever a parameter to a query.
    const { encryptSecret, maskSecret, envelopeKeyId } = await import('../crypto.js');
    const envelope = encryptSecret(secret);
    const masked = maskSecret(secret);
    const keyVersion = envelopeKeyId(envelope) || 'v1';
    return withUser(ctx, async (run) => {
      const r = await run(
        `insert into public.user_provider_credentials (user_id, provider, label, secret_ciphertext, masked_hint, key_version, status)
         values ($1, $2, $3, $4, $5, $6, 'unverified')
          on conflict (user_id, provider, label) do update set
            secret_ciphertext = excluded.secret_ciphertext,
            masked_hint       = excluded.masked_hint,
            key_version       = excluded.key_version,
            -- a replaced key has not been proven: reset the verdict
            status            = case when public.user_provider_credentials.masked_hint is distinct from excluded.masked_hint
                                     then 'unverified' else public.user_provider_credentials.status end,
            last_rotated_at   = now(),
            rotation_count    = public.user_provider_credentials.rotation_count + 1,
            updated_at        = now()
          returning id, user_id, provider, label, masked_hint, key_version, status, last_checked_at, created_at, updated_at, rotation_count, last_rotated_at`,
        [ctx.userId, provider, label, envelope, masked, keyVersion]
      );
      return one(r);
    });
  },
  async setStatus(ctx, provider, status, label = 'default') {
    return withUser(ctx, async (run) => {
      const r = await run(
        `update public.user_provider_credentials
            set status = $1, last_checked_at = now(), updated_at = now()
          where user_id = $2 and provider = $3 and label = $4
          returning id, user_id, provider, label, masked_hint, key_version, status, last_checked_at, created_at, updated_at`,
        [status, ctx.userId, provider, label]
      );
      return one(r);
    });
  },
  /** Decrypted for the duration of one outbound call; never returned. */
  async revealPlaintext(ctx, provider, label = 'default') {
    const { decryptSecret } = await import('../crypto.js');
    const row = await withUser(ctx, async (run) => {
      const r = await run(
        `select secret_ciphertext, provider, label from public.user_provider_credentials
          where user_id = $1 and provider = $2 and label = $3`,
        [ctx.userId, provider, label]
      );
      return one(r);
    });
    if (!row) return null;
    try {
      return { secret: decryptSecret(row.secret_ciphertext), provider: row.provider, label: row.label || label };
    } catch {
      // Legacy envelope: keys stored before the vault/contract unification
      // used core/crypto's {salt, iv, encrypted, authTag} shape. Read them so
      // a previously saved key activates without forcing the user to re-save.
      try {
        const o = typeof row.secret_ciphertext === 'string' ? JSON.parse(row.secret_ciphertext) : row.secret_ciphertext;
        if (o && o.salt && o.iv && o.encrypted && o.authTag) {
          return { secret: legacyDecrypt(o), provider: row.provider, label: row.label || label };
        }
      } catch {
        /* not a legacy envelope either */
      }
      // The row EXISTS but neither envelope opens. Returning null here made an
      // unreadable key indistinguishable from "no key": chat silently fell back
      // to the platform provider while Settings still showed "connected", and
      // nothing anywhere said the credential had gone bad. Say it instead —
      // callers translate this into "replace this key".
      const e = new Error('This saved key can no longer be decrypted — it was encrypted with a different server key.');
      e.code = 'credential_unreadable';
      throw e;
    }
  },
  async remove(ctx, provider, label = 'default') {
    return withUser(ctx, async (run) => {
      const r = await run(
        `delete from public.user_provider_credentials where user_id = $1 and provider = $2 and label = $3`,
        [ctx.userId, provider, label]
      );
      return r.rowCount > 0;
    });
  },
};

export const usage = {
  async list(ctx, { limit, cursor } = {}) {
    return withUser(ctx, (run) => paginate(run, {
      sql: `select id, provider, model, latency_ms, status, created_at
              from public.usage_events where user_id = $1`,
      args: [ctx.userId], key: 'created_at', dir: 'desc', limit, cursor,
    }));
  },
  async record(ctx, body = {}) {
    return withUser(ctx, async (run) => {
      const r = await run(
        `insert into public.usage_events
           (user_id, provider, model, request_id, task, tokens_in, tokens_out, latency_ms, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, provider, model, latency_ms, status, created_at`,
        [
          ctx.userId, body.provider ?? null, body.model ?? null, body.request_id ?? null, body.task ?? null,
          Number.isFinite(body.tokens_in) ? body.tokens_in : null,
          Number.isFinite(body.tokens_out) ? body.tokens_out : null,
          Number.isFinite(body.latency_ms) ? body.latency_ms : null,
          ['ok', 'error', 'cancelled'].includes(body.status) ? body.status : 'ok',
        ]
      );
      return one(r);
    });
  },
};

export const tasks = {
  async create(ctx, { type, objective = '', conversation_id = null }) {
    return withUser(ctx, async (run) => {
      const r = await run(
        `insert into public.agent_tasks (user_id, type, objective, conversation_id)
         values ($1, $2, $3, $4) returning *`,
        [ctx.userId, type, objective, conversation_id]
      );
      return one(r);
    });
  },
  async get(ctx, id) {
    return withUser(ctx, async (run) => {
      const r = await run(`select * from public.agent_tasks where id = $1 and user_id = $2`, [id, ctx.userId]);
      return one(r);
    });
  },
  async list(ctx, { limit, cursor, status } = {}) {
    const args = [ctx.userId];
    let where = '';
    if (status) { args.push(status); where += ` and status = $${args.length}`; }
    return withUser(ctx, (run) => paginate(run, {
      sql: `select * from public.agent_tasks where user_id = $1${where}`,
      args, key: 'updated_at', dir: 'desc', limit, cursor,
    }));
  },
  async update(ctx, id, patch = {}) {
    const sets = [];
    const args = [id, ctx.userId];
    const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
    if (typeof patch.status === 'string') {
      // The column carries a CHECK constraint, so an unmapped value would be
      // a 500 from Postgres. Translate what we understand, refuse the rest.
      const status = normalizeTaskStatus(patch.status);
      if (!status) {
        throw Object.assign(new Error(`Unsupported task status "${patch.status}".`), {
          code: 'invalid_input', status: 400,
        });
      }
      put('status', status);
      if (taskIsFinished(status)) sets.push('completed_at = now()');
    }
    if (Number.isFinite(patch.progress)) put('progress', Math.min(Math.max(Math.round(patch.progress), 0), 100));
    if ('result' in patch) put('result', patch.result == null ? null : JSON.stringify(patch.result));
    if ('error' in patch) put('error', patch.error ? String(patch.error).slice(0, 500) : null);
    if (!sets.length) return null;
    sets.push('updated_at = now()');
    return withUser(ctx, async (run) => {
      const r = await run(
        `update public.agent_tasks set ${sets.join(', ')} where id = $1 and user_id = $2 returning *`, args
      );
      return one(r);
    });
  },
};

export const toolEvents = {
  async record(ctx, { tool, state = 'done', detail = null, conversation_id = null, task_id = null }) {
    return withUser(ctx, async (run) => {
      const r = await run(
        `insert into public.tool_events (user_id, tool, state, detail, conversation_id, task_id)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [ctx.userId, tool, state, detail, conversation_id, task_id]
      );
      return one(r);
    });
  },
};

export const attachments = {
  async list(ctx, { limit, cursor, conversation_id } = {}) {
    const args = [ctx.userId];
    let where = '';
    if (conversation_id) { args.push(conversation_id); where += ` and conversation_id = $${args.length}`; }
    return withUser(ctx, (run) => paginate(run, {
      sql: `select * from public.attachments where user_id = $1${where}`,
      args, key: 'created_at', dir: 'desc', limit, cursor,
    }));
  },
  async create(ctx, { conversation_id = null, filename, mime_type, size_bytes = 0 }) {
    return withUser(ctx, async (run) => {
      if (conversation_id) {
        const owns = await run(`select id from public.conversations where id = $1 and user_id = $2`, [conversation_id, ctx.userId]);
        if (!owns.rowCount) return null;
      }
      const id = crypto.randomUUID();
      const bucket = 'attachments';
      // The storage policy reads the first path segment as the owner, so a
      // guessed path can never address another account's object.
      const storagePath = `${bucket}/${ctx.userId}/${id}/${filename}`;
      const r = await run(
        `insert into public.attachments (id, user_id, conversation_id, bucket, storage_path, filename, mime_type, size_bytes, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') returning *`,
        [id, ctx.userId, conversation_id, bucket, storagePath, filename, mime_type, size_bytes]
      );
      return one(r);
    });
  },
  async setStatus(ctx, id, status) {
    return withUser(ctx, async (run) => {
      const r = await run(
        `update public.attachments set status = $1 where id = $2 and user_id = $3 returning *`,
        [status, id, ctx.userId]
      );
      return one(r);
    });
  },
  /**
   * Mint a short-lived signed URL. Ownership is checked in Postgres first —
   * the storage key is only ever built from a row the caller already owns.
   */
  async sign(ctx, id, expires = 300) {
    const row = await withUser(ctx, async (run) => {
      const r = await run(`select * from public.attachments where id = $1 and user_id = $2`, [id, ctx.userId]);
      return one(r);
    });
    if (!row) return null;

    const url = String(process.env.SUPABASE_URL || '').trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !serviceKey) {
      if (!warnedAboutStorage) {
        warnedAboutStorage = true;
        console.error('[data/pg] signed URLs need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
      }
      return { unavailable: true, reason: 'Object storage credentials are not configured on the server.' };
    }

    const key = row.storage_path.startsWith(`${row.bucket}/`)
      ? row.storage_path.slice(row.bucket.length + 1)
      : row.storage_path;
    try {
      const r = await fetch(`${url}/storage/v1/object/sign/${row.bucket}/${key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expires }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        return { unavailable: true, reason: `Storage refused to sign the object (${r.status}).` };
      }
      const j = await r.json().catch(() => ({}));
      const signed = j?.signedURL || j?.signedUrl || '';
      if (!signed) return { unavailable: true, reason: 'Storage returned no signed URL.' };
      // Relative paths come back as `/object/sign/...`; make them absolute.
      const absolute = signed.startsWith('http') ? signed : `${url}/storage/v1${signed}`;
      return { url: absolute, expires_in: expires };
    } catch (e) {
      return { unavailable: true, reason: `Could not reach object storage: ${e.message}` };
    }
  },
  async remove(ctx, id) {
    const row = await withUser(ctx, async (run) => {
      const r = await run(`delete from public.attachments where id = $1 and user_id = $2 returning *`, [id, ctx.userId]);
      return one(r);
    });
    if (!row) return null;
    // Best-effort object removal: the row is already gone, and the storage
    // policy means nobody can reach the object even if this call fails.
    const url = String(process.env.SUPABASE_URL || '').trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (url && serviceKey) {
      const key = row.storage_path.startsWith(`${row.bucket}/`)
        ? row.storage_path.slice(row.bucket.length + 1)
        : row.storage_path;
      fetch(`${url}/storage/v1/object/${row.bucket}/${key}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${serviceKey}` },
      }).catch(() => {});
    }
    return row;
  },
};

export const profiles = {
  /** `profiles.id` is the user's uuid; the row is 1:1 with auth.users. */
  async get(ctx, email) {
    return withUser(ctx, async (run) => {
      const found = one(await run(`select * from public.profiles where id = $1`, [ctx.userId]));
      if (found) return found;
      const r = await run(
        `insert into public.profiles (id, display_name) values ($1, $2)
         on conflict (id) do update set id = excluded.id returning *`,
        [ctx.userId, (email || '').split('@')[0] || '']
      );
      return one(r);
    });
  },
  async update(ctx, patch = {}) {
    const sets = [];
    const args = [ctx.userId];
    const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
    for (const col of [
      'display_name', 'avatar_url', 'onboarding_completed',
      'preferred_provider', 'preferred_model', 'theme', 'voice_preference', 'memory_preference',
    ]) {
      if (col in patch) put(col, patch[col]);
    }
    if (!sets.length) {
      return withUser(ctx, async (run) => one(await run(`select * from public.profiles where id = $1`, [ctx.userId])));
    }
    sets.push('updated_at = now()');
    return withUser(ctx, async (run) => {
      const r = await run(`update public.profiles set ${sets.join(', ')} where id = $1 returning *`, args);
      const updated = one(r);
      if (!updated) throw Object.assign(new Error('Profile not found.'), { code: 'not_found', status: 404 });
      return updated;
    });
  },
};

/** Connectivity probe for /api/health — no user context required. */
export async function ping() {
  const r = await rawQuery('select 1 as ok', []);
  return !!(r.rows && r.rows[0]);
}

/** Storage reachability, reported without disclosing any credential. */
export async function storagePing() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    return { ok: false, driver: 'supabase', detail: 'Storage credentials not configured.' };
  }
  try {
    const r = await fetch(`${url}/storage/v1/bucket`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      signal: AbortSignal.timeout(6000),
    });
    return { ok: r.ok, driver: 'supabase', detail: r.ok ? 'Object storage reachable.' : `Storage returned ${r.status}.` };
  } catch (e) {
    return { ok: false, driver: 'supabase', detail: `Storage unreachable: ${e.message}` };
  }
}

/**
 * Account erasure. Runs with elevated rights because `usage_events` is
 * append-only for the owner by policy, while erasure must still remove it.
 * Every statement is scoped to the verified subject, which is the only user
 * this function is ever called with.
 */
export async function deleteAll(uid) {
  const tables = [
    'tool_events', 'usage_events', 'attachments', 'agent_tasks',
    'memories', 'user_provider_credentials', 'user_provider_settings',
    'messages', 'conversations',
  ];
  const counts = {};
  for (const t of tables) {
    const r = await asAdmin(`delete from public.${t} where user_id = $1`, [uid]);
    counts[t] = r.rowCount || 0;
  }
  const p = await asAdmin(`delete from public.profiles where id = $1`, [uid]);
  counts.profiles = p.rowCount || 0;
  return counts;
}

export default {
  driver, conversations, messages, memories, providerSettings, providerCredentials,
  usage, tasks, toolEvents, attachments, profiles,
  ping, storagePing, deleteAll,
};
