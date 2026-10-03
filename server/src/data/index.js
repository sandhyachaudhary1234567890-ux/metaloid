// Account-data layer — the ONE place user-owned rows are read and written.
//
// Two drivers, one interface, identical result shapes:
//   * `file`      → ./file.js  (JSON under METALOID_DATA_DIR; local + self-host)
//   * `supabase`  → ./pg.js    (Postgres via SUPABASE_DB_POOL_URL; production)
//
// Selected by `SUPABASE_DB=supabase`, which is the documented switch. The API
// layer (api/v1.js) and the rest of the gateway never learn which driver is
// live: they see rows, pages and `null`s.
//
// Identity rule, applied without exception: `ctx.userId` comes from a verified
// JWT (auth.js → req.user.id). No repository accepts a user id from a request
// body, query string or header, and every read filters on it. Ownership is
// therefore enforced twice — once here, once by the query — on top of RLS.

import { encryptionConfigured, encryptionInfo, encryptSecret, decryptSecret, maskSecret, envelopeKeyId } from '../crypto.js';
import { supabaseConfigured } from '../core/supabase.js';
import * as file from './file.js';
import * as pg from './pg.js';
import { uuid, nowIso, page, DATA_DIR } from './file.js';
import { normalizeTaskStatus, taskIsFinished } from './vocabulary.js';

export { DATA_DIR };

/** `SUPABASE_DB=supabase` selects Postgres; anything else is the file store. */
export const dbMode = () => String(process.env.SUPABASE_DB || '').toLowerCase() === 'supabase';

const LOCAL = 'local';
const SUPA = 'supabase';

/** Postgres is only usable when a pooler URL is actually configured. */
function postgresReady() {
  return Boolean(String(process.env.SUPABASE_DB_POOL_URL || '').trim());
}

function driver() {
  if (dbMode() && postgresReady()) return SUPA;
  return LOCAL;
}

const using = () => (driver() === SUPA ? pg : fileRepos);

// ── shapes ──────────────────────────────────────────────────────────────
// These are the contract shapes the web app (src/lib/repo.ts) and the future
// Android client are written against. They are what `docs/ANDROID_API.md`
// documents; changing one is a breaking API change.

const conversationRow = (r) => ({
  id: r.id,
  user_id: r.user_id,
  title: r.title,
  model: r.model ?? null,
  provider: r.provider ?? null,
  archived: !!r.archived,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const messageRow = (r) => ({
  id: r.id,
  conversation_id: r.conversation_id,
  user_id: r.user_id,
  role: r.role,
  content: r.content ?? '',
  model: r.model ?? null,
  provider: r.provider ?? null,
  status: r.status || 'complete',
  error_code: r.error_code ?? null,
  created_at: r.created_at,
});

const memoryRow = (r) => ({
  id: r.id,
  user_id: r.user_id,
  content: r.content,
  category: r.category ?? 'Personal',
  kind: r.kind ?? 'explicit',
  pinned: !!r.pinned,
  created_at: r.created_at,
  updated_at: r.updated_at ?? r.created_at,
});

const attachmentRow = (r) => ({
  id: r.id,
  user_id: r.user_id,
  conversation_id: r.conversation_id ?? null,
  bucket: r.bucket || 'attachments',
  storage_path: r.storage_path,
  filename: r.filename,
  mime_type: r.mime_type || 'application/octet-stream',
  size_bytes: Number(r.size_bytes) || 0,
  status: r.status || 'pending',
  created_at: r.created_at,
});

const taskRow = (r) => ({
  id: r.id,
  user_id: r.user_id,
  type: r.type,
  objective: r.objective ?? '',
  status: r.status || 'QUEUED',
  progress: Number.isFinite(r.progress) ? r.progress : 0,
  result: r.result ?? null,
  error: r.error ?? null,
  conversation_id: r.conversation_id ?? null,
  created_at: r.created_at,
  updated_at: r.updated_at ?? r.created_at,
  completed_at: r.completed_at ?? null,
});

const profileRow = (r) => ({
  // `profiles.id` IS the user's uuid (the table is 1:1 with auth.users); there
  // is no user_id column. Reading the wrong one produced a profile with an
  // undefined id, which every ownership comparison downstream then believed.
  id: r.id ?? r.user_id,
  display_name: r.display_name ?? '',
  avatar_url: r.avatar_url ?? null,
  onboarding_completed: !!r.onboarding_completed,
  preferred_provider: r.preferred_provider ?? null,
  preferred_model: r.preferred_model ?? null,
  theme: r.theme || 'obsidian',
  voice_preference: r.voice_preference || 'natural',
  memory_preference: r.memory_preference || 'on',
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const settingsRow = (r) => ({
  user_id: r.user_id,
  default_provider: r.default_provider ?? null,
  default_model: r.default_model ?? null,
  fallback_enabled: !!r.fallback_enabled,
  free_only: r.free_only !== false,
  updated_at: r.updated_at,
});

/** Only these ever leave the server; the secret itself never does. */
const credentialRow = (r) => ({
  id: r.id,
  provider: r.provider,
  label: r.label || 'default',
  masked_hint: r.masked_hint || '',
  status: r.status || 'unverified',
  key_version: r.key_version || '',
  last_checked_at: r.last_checked_at ?? null,
  updated_at: r.updated_at,
});

const usageRow = (r) => ({
  id: r.id,
  provider: r.provider ?? null,
  model: r.model ?? null,
  latency_ms: Number.isFinite(r.latency_ms) ? r.latency_ms : null,
  status: r.status || 'ok',
  created_at: r.created_at,
});

const toolEventRow = (r) => ({
  id: r.id,
  user_id: r.user_id,
  tool: r.tool,
  state: r.state || 'done',
  detail: r.detail ?? null,
  conversation_id: r.conversation_id ?? null,
  task_id: r.task_id ?? null,
  created_at: r.created_at,
});

// ── file driver ─────────────────────────────────────────────────────────
const C = {
  conversations: file.collection('conversations'),
  messages: file.collection('messages'),
  memories: file.collection('memories'),
  profiles: file.collection('profiles'),
  settings: file.collection('provider_settings'),
  credentials: file.collection('provider_credentials'),
  usage: file.collection('usage_events'),
  tasks: file.collection('agent_tasks'),
  toolEvents: file.collection('tool_events'),
  attachments: file.collection('attachments'),
};

const fileRepos = {
  driver: LOCAL,

  conversations: {
    async create(ctx, { title, model = null, provider = null }) {
      const at = nowIso();
      return conversationRow(C.conversations.insert({
        id: uuid(), user_id: ctx.userId,
        title: title || 'New conversation',
        model, provider, archived: false,
        created_at: at, updated_at: at,
      }));
    },
    async get(ctx, id) {
      const r = C.conversations.find(ctx.userId, id);
      return r ? conversationRow(r) : null;
    },
    async list(ctx, { limit, cursor } = {}) {
      const mine = C.conversations.mine(ctx.userId).filter((r) => !r.archived);
      const out = page(mine, { limit, cursor }, {
        keyOf: (r) => r.updated_at, tieOf: (r) => r.id, desc: true,
      });
      return { rows: out.rows.map(conversationRow), next_cursor: out.next_cursor };
    },
    async update(ctx, id, patch = {}) {
      const r = C.conversations.find(ctx.userId, id);
      if (!r) return null;
      const next = {};
      if (typeof patch.title === 'string' && patch.title.trim()) next.title = patch.title.trim().slice(0, 200);
      if ('model' in patch) next.model = patch.model ? String(patch.model).slice(0, 120) : null;
      if ('provider' in patch) next.provider = patch.provider ? String(patch.provider).slice(0, 40) : null;
      if ('archived' in patch) next.archived = !!patch.archived;
      next.updated_at = nowIso();
      return conversationRow(C.conversations.patch(ctx.userId, id, next));
    },
    /**
     * Hard delete, mirroring the real foreign keys: messages belonging to
     * the conversation cascade away, and tool events lose their link rather
     * than their history (they are an audit trail, not conversation content).
     */
    async remove(ctx, id) {
      const r = C.conversations.find(ctx.userId, id);
      if (!r) return false;
      for (const m of C.messages.mine(ctx.userId).filter((x) => x.conversation_id === id)) {
        C.messages.remove(ctx.userId, m.id);
      }
      for (const ev of C.toolEvents.mine(ctx.userId).filter((x) => x.conversation_id === id)) {
        C.toolEvents.patch(ctx.userId, ev.id, { conversation_id: null });
      }
      return C.conversations.remove(ctx.userId, id);
    },
  },

  messages: {
    async append(ctx, conversationId, { role, content, model = null, provider = null, status = 'complete', metadata = {} }) {
      const conv = C.conversations.find(ctx.userId, conversationId);
      if (!conv) return null;
      const at = nowIso();
      const row = messageRow(C.messages.insert({
        id: uuid(), conversation_id: conversationId, user_id: ctx.userId,
        role, content, model, provider, status, error_code: null,
        metadata, tokens: null, latency_ms: null,
        created_at: at, updated_at: at,
      }));
      C.conversations.patch(ctx.userId, conversationId, { updated_at: at });
      return row;
    },
    async list(ctx, conversationId, { limit, cursor } = {}) {
      const conv = C.conversations.find(ctx.userId, conversationId);
      if (!conv) return null;
      const mine = C.messages.mine(ctx.userId).filter((m) => m.conversation_id === conversationId);
      // Oldest-first: a transcript reads forwards, and the client renders the
      // rows in the order it receives them.
      const out = page(mine, { limit, cursor }, {
        keyOf: (r) => r.created_at, tieOf: (r) => r.id, desc: false,
      });
      return { rows: out.rows.map(messageRow), next_cursor: out.next_cursor };
    },
    async update(ctx, id, patch = {}) {
      const r = C.messages.mine(ctx.userId).find((m) => m.id === id);
      if (!r) return null;
      const next = {};
      if (typeof patch.content === 'string') next.content = patch.content.slice(0, 32000);
      if (['streaming', 'complete', 'cancelled', 'error'].includes(patch.status)) next.status = patch.status;
      if ('error_code' in patch) next.error_code = patch.error_code ? String(patch.error_code).slice(0, 60) : null;
      if (Number.isFinite(patch.tokens)) next.tokens = patch.tokens;
      if (Number.isFinite(patch.latency_ms)) next.latency_ms = patch.latency_ms;
      return messageRow(C.messages.patch(ctx.userId, id, next));
    },
    /** Anything left mid-stream is closed as cancelled, never left open. */
    async markStale(ctx, conversationId) {
      const open = C.messages.mine(ctx.userId)
        .filter((m) => m.conversation_id === conversationId && m.status === 'streaming');
      for (const m of open) {
        // The reason is recorded, not implied: a UI showing "cancelled" with
        // no cause cannot tell an interrupted stream from a user stop.
        C.messages.patch(ctx.userId, m.id, { status: 'cancelled', error_code: 'interrupted' });
      }
      return open.length;
    },
  },

  memories: {
    async create(ctx, { content, category = 'Personal', kind = 'explicit', pinned = false }) {
      const at = nowIso();
      return memoryRow(C.memories.insert({
        id: uuid(), user_id: ctx.userId, content, category, kind, pinned,
        source_conversation_id: null,
        created_at: at, updated_at: at,
      }));
    },
    async list(ctx, { limit, cursor, kind, query } = {}) {
      let mine = C.memories.mine(ctx.userId);
      if (kind) mine = mine.filter((m) => m.kind === kind);
      if (query) {
        const q = String(query).toLowerCase();
        mine = mine.filter((m) => String(m.content || '').toLowerCase().includes(q));
      }
      const out = page(mine, { limit, cursor }, {
        keyOf: (r) => r.created_at, tieOf: (r) => r.id, desc: true,
      });
      return { rows: out.rows.map(memoryRow), next_cursor: out.next_cursor };
    },
    async update(ctx, id, patch = {}) {
      const r = C.memories.mine(ctx.userId).find((m) => m.id === id);
      if (!r) return null;
      const next = {};
      if (typeof patch.content === 'string' && patch.content.trim()) next.content = patch.content.trim().slice(0, 2000);
      if (typeof patch.category === 'string') next.category = patch.category.slice(0, 40);
      if (['explicit', 'project', 'conversation', 'preference', 'inferred'].includes(patch.kind)) next.kind = patch.kind;
      if ('pinned' in patch) next.pinned = !!patch.pinned;
      next.updated_at = nowIso();
      return memoryRow(C.memories.patch(ctx.userId, id, next));
    },
    async remove(ctx, id) {
      const r = C.memories.mine(ctx.userId).find((m) => m.id === id);
      if (!r) return false;
      return C.memories.remove(ctx.userId, id);
    },
  },

  providerSettings: {
    async get(ctx) {
      const r = C.settings.mine(ctx.userId)[0];
      return r ? settingsRow(r) : null;
    },
    async upsert(ctx, patch = {}) {
      const existing = C.settings.mine(ctx.userId)[0];
      const next = { ...(existing || {}), ...patch, user_id: ctx.userId, updated_at: nowIso() };
      if (!existing) {
        next.id = uuid();
        next.created_at = next.updated_at;
        next.free_only = patch.free_only !== false;
        C.settings.insert(next);
      } else {
        C.settings.patch(ctx.userId, existing.id, next);
      }
      return settingsRow(C.settings.mine(ctx.userId)[0]);
    },
  },

  providerCredentials: {
    async list(ctx) {
      return C.credentials.mine(ctx.userId).map(credentialRow);
    },
    async upsert(ctx, { provider, label = 'default', secret }) {
      const envelope = encryptSecret(secret);
      const masked = maskSecret(secret);
      const keyVersion = envelopeKeyId(envelope) || '';
      const existing = C.credentials.mine(ctx.userId).find((c) => c.provider === provider && (c.label || 'default') === label);
      const at = nowIso();
      if (existing) {
        const rotated = { ...existing, encrypted_secret: envelope, masked_hint: masked, key_version: keyVersion, updated_at: at };
        // A newly supplied key has not been proven yet; a rotation also
        // resets the trust signal rather than inheriting the old verdict.
        if (existing.masked_hint !== masked) rotated.status = 'unverified';
        return credentialRow(C.credentials.patch(ctx.userId, existing.id, rotated));
      }
      return credentialRow(C.credentials.insert({
        id: uuid(), user_id: ctx.userId, provider, label,
        encrypted_secret: envelope, masked_hint: masked, key_version: keyVersion,
        status: 'unverified', is_active: true, metadata: {},
        last_checked_at: null, last_tested_at: null, last_test_status: null,
        rotation_count: 0, created_at: at, updated_at: at,
      }));
    },
    async setStatus(ctx, provider, status, label = 'default') {
      const c = C.credentials.mine(ctx.userId).find((x) => x.provider === provider && (x.label || 'default') === label);
      if (!c) return null;
      const at = nowIso();
      return credentialRow(C.credentials.patch(ctx.userId, c.id, {
        status, last_checked_at: at, last_tested_at: at, last_test_status: status, updated_at: at,
      }));
    },
    /** In-memory decryption for one outbound call. Never returned to a client. */
    async revealPlaintext(ctx, provider, label = 'default') {
      const c = C.credentials.mine(ctx.userId).find((x) => x.provider === provider && (x.label || 'default') === label);
      if (!c || !c.encrypted_secret) return null;
      try {
        return { secret: decryptSecret(c.encrypted_secret), provider: c.provider, label: c.label || 'default' };
      } catch {
        return null;
      }
    },
    async remove(ctx, provider, label = 'default') {
      const c = C.credentials.mine(ctx.userId).find((x) => x.provider === provider && (x.label || 'default') === label);
      if (!c) return false;
      return C.credentials.remove(ctx.userId, c.id);
    },
  },

  usage: {
    async list(ctx, { limit, cursor } = {}) {
      const out = page(C.usage.mine(ctx.userId), { limit, cursor }, {
        keyOf: (r) => r.created_at, tieOf: (r) => r.id, desc: true,
      });
      return { rows: out.rows.map(usageRow), next_cursor: out.next_cursor };
    },
    async record(ctx, body = {}) {
      const row = C.usage.insert({
        id: uuid(), user_id: ctx.userId,
        provider: body.provider ?? null, model: body.model ?? null,
        request_id: body.request_id ?? null, task: body.task ?? null,
        tokens_in: body.tokens_in ?? null, tokens_out: body.tokens_out ?? null,
        latency_ms: body.latency_ms ?? null, status: body.status || 'ok',
        kind: body.task || 'chat', created_at: nowIso(),
      });
      return usageRow(row);
    },
  },

  tasks: {
    async create(ctx, { type, objective = '', conversation_id = null }) {
      const at = nowIso();
      return taskRow(C.tasks.insert({
        id: uuid(), user_id: ctx.userId, type, objective,
        status: 'queued', progress: 0, result: null, error: null,
        conversation_id, created_at: at, updated_at: at, completed_at: null,
      }));
    },
    async get(ctx, id) {
      const r = C.tasks.find(ctx.userId, id);
      return r ? taskRow(r) : null;
    },
    async list(ctx, { limit, cursor, status } = {}) {
      let mine = C.tasks.mine(ctx.userId);
      if (status) mine = mine.filter((t) => t.status === status);
      const out = page(mine, { limit, cursor }, {
        keyOf: (r) => r.updated_at, tieOf: (r) => r.id, desc: true,
      });
      return { rows: out.rows.map(taskRow), next_cursor: out.next_cursor };
    },
    async update(ctx, id, patch = {}) {
      const r = C.tasks.find(ctx.userId, id);
      if (!r) return null;
      const next = {};
      if (typeof patch.status === 'string') {
        // Same vocabulary as the Postgres CHECK constraint, so the two
        // drivers cannot drift on what a "finished" task looks like.
        const status = normalizeTaskStatus(patch.status);
        if (!status) {
          throw Object.assign(new Error(`Unsupported task status "${patch.status}".`), {
            code: 'invalid_input', status: 400,
          });
        }
        next.status = status;
        if (taskIsFinished(status)) next.completed_at = nowIso();
      }
      if (Number.isFinite(patch.progress)) next.progress = Math.min(Math.max(patch.progress, 0), 100);
      if ('result' in patch) next.result = patch.result;
      if ('error' in patch) next.error = patch.error ? String(patch.error).slice(0, 500) : null;
      next.updated_at = nowIso();
      return taskRow(C.tasks.patch(ctx.userId, id, next));
    },
  },

  toolEvents: {
    async record(ctx, { tool, state = 'done', detail = null, conversation_id = null, task_id = null }) {
      return toolEventRow(C.toolEvents.insert({
        id: uuid(), user_id: ctx.userId, tool, state, detail,
        conversation_id, task_id, created_at: nowIso(),
      }));
    },
  },

  attachments: {
    async list(ctx, { limit, cursor, conversation_id } = {}) {
      let mine = C.attachments.mine(ctx.userId);
      if (conversation_id) mine = mine.filter((a) => a.conversation_id === conversation_id);
      const out = page(mine, { limit, cursor }, {
        keyOf: (r) => r.created_at, tieOf: (r) => r.id, desc: true,
      });
      return { rows: out.rows.map(attachmentRow), next_cursor: out.next_cursor };
    },
    async create(ctx, { conversation_id = null, filename, mime_type, size_bytes = 0 }) {
      if (conversation_id) {
        const conv = C.conversations.find(ctx.userId, conversation_id);
        if (!conv) return null;
      }
      const id = uuid();
      const bucket = 'attachments';
      // Path convention enforced by the storage policy in production:
      //   {bucket}/{user_id}/{file_id}/{filename}
      const storagePath = `${bucket}/${ctx.userId}/${id}/${filename}`;
      return attachmentRow(C.attachments.insert({
        id, user_id: ctx.userId, conversation_id,
        bucket, storage_path: storagePath, filename,
        mime_type, size_bytes, status: 'ready', created_at: nowIso(),
      }));
    },
    async setStatus(ctx, id, status) {
      const r = C.attachments.find(ctx.userId, id);
      if (!r) return null;
      return attachmentRow(C.attachments.patch(ctx.userId, id, { status }));
    },
    /**
     * Signed URLs are minted by object storage, which the file driver does not
     * have. Reporting that honestly is required: a fabricated URL here would
     * show the user a broken image and call it success.
     */
    async sign(ctx, id) {
      const r = C.attachments.find(ctx.userId, id);
      if (!r) return null;
      return {
        unavailable: true,
        reason: 'Object storage is not configured on this driver. Set SUPABASE_DB=supabase with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable uploads.',
      };
    },
    async remove(ctx, id) {
      const r = C.attachments.find(ctx.userId, id);
      if (!r) return null;
      C.attachments.remove(ctx.userId, id);
      return attachmentRow(r);
    },
  },

  profiles: {
    /**
     * `profiles.id` is the user's own uuid (the table is 1:1 with
     * auth.users), which is why this collection is addressed by `id`
     * rather than `user_id`.
     */
    async get(ctx, email) {
      const existing = C.profiles.find(ctx.userId, ctx.userId, 'id');
      if (existing) return profileRow(existing);
      const at = nowIso();
      const created = C.profiles.insert({
        id: ctx.userId,
        display_name: (email || '').split('@')[0] || '',
        avatar_url: null, onboarding_completed: false,
        preferred_provider: null, preferred_model: null,
        theme: 'obsidian', voice_preference: 'natural', memory_preference: 'on',
        created_at: at, updated_at: at,
      });
      return profileRow(created);
    },
    /**
     * Upsert, never 404. `PATCH /me` is frequently the first request a new
     * account makes (onboarding, theme), so a missing row means "not created
     * yet", not "not found".
     */
    async update(ctx, patch = {}) {
      const existing = C.profiles.find(ctx.userId, ctx.userId, 'id');
      if (!existing) {
        const at = nowIso();
        return profileRow(C.profiles.insert({
          id: ctx.userId, display_name: '', avatar_url: null, onboarding_completed: false,
          preferred_provider: null, preferred_model: null,
          theme: 'obsidian', voice_preference: 'natural', memory_preference: 'on',
          created_at: at, updated_at: at, ...patch,
        }));
      }
      return profileRow(C.profiles.patch(ctx.userId, existing.id, { ...patch, updated_at: nowIso() }, 'id'));
    },
  },
};

// ── driver-facing surface ───────────────────────────────────────────────
// Each accessor resolves the live driver per call, so flipping SUPABASE_DB
// takes effect without restarting a serverless instance.
const pick = (name) => {
  const d = using();
  return d[name];
};

export const conversations = new Proxy({}, {
  get: (_, k) => (k === 'driver' ? driver() : (...a) => pick('conversations')[k](...a)),
});

export const messages = new Proxy({}, {
  get: (_, k) => (...a) => pick('messages')[k](...a),
});

export const memories = new Proxy({}, {
  get: (_, k) => (...a) => pick('memories')[k](...a),
});

export const providerSettings = new Proxy({}, {
  get: (_, k) => (...a) => pick('providerSettings')[k](...a),
});

export const providerCredentials = new Proxy({}, {
  get: (_, k) => (...a) => pick('providerCredentials')[k](...a),
});

export const usage = new Proxy({}, {
  get: (_, k) => (...a) => pick('usage')[k](...a),
});

export const tasks = new Proxy({}, {
  get: (_, k) => (...a) => pick('tasks')[k](...a),
});

export const toolEvents = new Proxy({}, {
  get: (_, k) => (...a) => pick('toolEvents')[k](...a),
});

export const attachments = new Proxy({}, {
  get: (_, k) => (...a) => pick('attachments')[k](...a),
});

export const profiles = new Proxy({}, {
  get: (_, k) => (...a) => pick('profiles')[k](...a),
});

/** Which driver is live. Surfaced by /api/v1/health and /api/health. */
export function driverName() {
  return driver();
}

/**
 * Everything an operator needs to reason about storage, and nothing that
 * could leak: no URLs, no credentials, no pool strings. Read verbatim by the
 * `/api/health` handler, so the shape is part of that contract.
 */
export function driverInfo() {
  const live = driver();
  const supaUrlSet = Boolean(String(process.env.SUPABASE_URL || '').trim());
  return {
    driver: live,
    production: live === SUPA,
    durable: live === SUPA,
    supabase_configured: supabaseConfigured(),
    supabase_url_set: supaUrlSet,
    // `local` has no object storage; saying so is what stops the UI offering
    // uploads that cannot succeed.
    storage: live === SUPA
      ? (String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() ? 'supabase' : 'unconfigured')
      : 'local',
    data_dir: live === LOCAL ? DATA_DIR : null,
    encryption: encryptionInfo(),
    note: live === SUPA
      ? 'Postgres (Supabase) — durable, RLS enforced.'
      : 'Local store — fine for development and self-hosting. Set SUPABASE_DB=supabase for durable production storage.',
  };
}

/** Liveness probe for the storage driver itself. */
export async function ping() {
  const t0 = Date.now();
  try {
    if (driver() === SUPA) {
      const ok = await pg.ping();
      return { ok: !!ok, driver: SUPA, detail: 'Postgres reachable.', latency_ms: Date.now() - t0 };
    }
    // Proves the directory is actually writable — not merely that it exists.
    await file.collection('__ping').insert({ id: uuid(), user_id: '__ping', created_at: nowIso() });
    file.collection('__ping').dropOwner('__ping');
    return { ok: true, driver: LOCAL, detail: 'Local store writable.', latency_ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, driver: driver(), detail: e.message, latency_ms: Date.now() - t0 };
  }
}

/** Object-storage probe. Only Postgres mode has real object storage. */
export async function storagePing() {
  if (driver() !== SUPA) {
    return { ok: false, driver: LOCAL, detail: 'The local store has no object storage.', buckets: null };
  }
  return pg.storagePing();
}

/**
 * Full account erasure. Called only from DELETE /api/v1/me, where the caller
 * can only ever be themselves. Removes account rows first, then the older
 * domain stores, so a partial failure never leaves the account half-deleted
 * with its conversations already gone.
 */
export async function deleteUserData(ctx) {
  const uid = ctx.userId;
  const removed = {};

  if (driver() === SUPA) {
    removed.rows = await pg.deleteAll(uid);
  } else {
    for (const [name, coll] of Object.entries(C)) {
      removed[name] = coll.dropOwner(uid, name === 'profiles' ? 'id' : 'user_id');
    }
  }

  // Domain stores written by the flat gateway routes (core/*). Imported
  // lazily and individually so one absent module cannot abort an account
  // deletion halfway through.
  const sweep = [
    ['../core/memory.js', 'deleteUserMemories'],
    ['../core/profiles.js', 'deleteProfile'],
    ['../core/projectMemory.js', 'deleteUserProjectMemory'],
    ['../core/users.js', 'deleteUser'],
    ['../core/workspaces.js', 'deleteUserWorkspaces'],
    ['../core/credentialVault.js', 'deleteUserCredentials'],
  ];
  for (const [mod, fn] of sweep) {
    try {
      const m = await import(mod);
      if (typeof m[fn] === 'function') {
        await m[fn](uid);
        removed[fn] = true;
      }
    } catch { /* module or export absent — nothing to erase there */ }
  }

  return removed;
}

export default {
  conversations, messages, memories, providerSettings, providerCredentials,
  usage, tasks, toolEvents, attachments, profiles,
  deleteUserData, driverName, driverInfo, ping, storagePing, dbMode,
};
