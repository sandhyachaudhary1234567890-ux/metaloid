// Authenticated product API (v1).
//
// Contract for BOTH clients: the web app today and the Android app later.
// Android talks to these endpoints and never to Postgres directly (spec §45),
// so every response here is a stable, documented shape.
//
// Rules applied uniformly:
//   * `requireAuth` runs before anything else on this router, so an
//     unauthenticated call can never reach a repository
//   * identity ALWAYS comes from req.user.id (verified JWT) — a user_id in a
//     body, a query string or a header is ignored, never trusted
//   * ownership is enforced again in the query (belt and braces: RLS is the
//     boundary, the filter is the intent)
//   * provider secrets go in, never out — responses carry only a mask
//
// Error contract (stable, so clients can switch on `code`):
//   no_token · invalid_token · token_expired · auth_unconfigured
//   not_found · invalid_input · encryption_unconfigured · db_error
//   provider_test_failed · rate_limited

import express from 'express';
import { requireAuth } from '../auth.js';
import {
  conversations, messages, memories, providerSettings, providerCredentials,
  usage, tasks, toolEvents, attachments, profiles, deleteUserData, driverName,
} from '../data/index.js';
import { encryptionConfigured } from '../crypto.js';

const router = express.Router();

// ── tiny helpers ────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function bad(res, code, message, status = 400) {
  return res.status(status).json({ error: message, code });
}

/** Wrap async handlers so a thrown repository error becomes a clean JSON error. */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ctx = (req) => ({ userId: req.user.id, token: req.accessToken });
const limitQ = (q) => ({ limit: q.limit, cursor: q.cursor || null });

// ── profile + onboarding ────────────────────────────────────────────────
router.get('/me', h(async (req, res) => {
  const profile = await profiles.get(ctx(req), req.user.email);
  res.json({ user: { id: req.user.id, email: req.user.email || null }, profile });
}));

router.patch('/me', h(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (typeof b.display_name === 'string') patch.display_name = b.display_name.slice(0, 80);
  if (typeof b.avatar_url === 'string') patch.avatar_url = b.avatar_url.slice(0, 500);
  if (typeof b.onboarding_completed === 'boolean') patch.onboarding_completed = b.onboarding_completed;
  if (typeof b.preferred_provider === 'string') patch.preferred_provider = b.preferred_provider.slice(0, 40);
  if (typeof b.preferred_model === 'string') patch.preferred_model = b.preferred_model.slice(0, 120);
  if (typeof b.theme === 'string') patch.theme = b.theme.slice(0, 24);
  if (typeof b.voice_preference === 'string') patch.voice_preference = b.voice_preference.slice(0, 40);
  if (typeof b.memory_preference === 'string') patch.memory_preference = b.memory_preference.slice(0, 24);
  if (!Object.keys(patch).length) return bad(res, 'invalid_input', 'No supported fields to update.');
  const profile = await profiles.update(ctx(req), patch);
  res.json({ profile });
}));

/**
 * Account deletion: identity from the session only. A caller can only ever
 * delete themselves — there is no id parameter to abuse.
 */
router.delete('/me', h(async (req, res) => {
  if (req.body?.confirm !== 'DELETE') {
    return bad(res, 'invalid_input', 'Send { "confirm": "DELETE" } to delete this account.');
  }
  await deleteUserData(ctx(req));
  res.json({ deleted: true });
}));

// ── conversations ───────────────────────────────────────────────────────
router.post('/conversations', h(async (req, res) => {
  const b = req.body || {};
  const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : 'New conversation';
  const row = await conversations.create(ctx(req), {
    title,
    model: typeof b.model === 'string' ? b.model.slice(0, 120) : null,
    provider: typeof b.provider === 'string' ? b.provider.slice(0, 40) : null,
  });
  res.status(201).json({ conversation: row });
}));

router.get('/conversations', h(async (req, res) => {
  const out = await conversations.list(ctx(req), limitQ(req.query));
  res.json(out);
}));

router.get('/conversations/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed conversation id.');
  const row = await conversations.get(ctx(req), req.params.id);
  if (!row) return bad(res, 'not_found', 'Conversation not found.', 404);
  res.json({ conversation: row });
}));

router.patch('/conversations/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed conversation id.');
  const row = await conversations.update(ctx(req), req.params.id, req.body || {});
  if (!row) return bad(res, 'not_found', 'Conversation not found.', 404);
  res.json({ conversation: row });
}));

router.delete('/conversations/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed conversation id.');
  const ok = await conversations.remove(ctx(req), req.params.id);
  if (!ok) return bad(res, 'not_found', 'Conversation not found.', 404);
  res.json({ deleted: true });
}));

// ── messages ────────────────────────────────────────────────────────────
router.get('/conversations/:id/messages', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed conversation id.');
  const out = await messages.list(ctx(req), req.params.id, limitQ(req.query));
  if (!out) return bad(res, 'not_found', 'Conversation not found.', 404);
  res.json(out);
}));

router.post('/conversations/:id/messages', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed conversation id.');
  const b = req.body || {};
  const role = ['user', 'assistant', 'tool', 'system'].includes(b.role) ? b.role : 'user';
  if (typeof b.content !== 'string' || !b.content.trim()) {
    return bad(res, 'invalid_input', 'Message content is required.');
  }
  if (b.content.length > 32000) return bad(res, 'invalid_input', 'Message is too long.');
  const row = await messages.append(ctx(req), req.params.id, {
    role, content: b.content.slice(0, 32000),
    model: typeof b.model === 'string' ? b.model.slice(0, 120) : null,
    provider: typeof b.provider === 'string' ? b.provider.slice(0, 40) : null,
    status: ['streaming', 'complete', 'cancelled', 'error'].includes(b.status) ? b.status : 'complete',
    metadata: b.metadata && typeof b.metadata === 'object' ? b.metadata : {},
  });
  if (!row) return bad(res, 'not_found', 'Conversation not found.', 404);
  res.status(201).json({ message: row });
}));

router.patch('/messages/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed message id.');
  const row = await messages.update(ctx(req), req.params.id, req.body || {});
  if (!row) return bad(res, 'not_found', 'Message not found.', 404);
  res.json({ message: row });
}));

/** Recovery: anything left mid-stream is marked cancelled, not left open. */
router.post('/conversations/:id/messages/recover', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed conversation id.');
  const n = await messages.markStale(ctx(req), req.params.id);
  res.json({ recovered: n });
}));

// ── memories ────────────────────────────────────────────────────────────
router.get('/memories', h(async (req, res) => {
  const out = await memories.list(ctx(req), {
    ...limitQ(req.query), kind: req.query.kind, query: req.query.q,
  });
  res.json(out);
}));

router.post('/memories', h(async (req, res) => {
  const b = req.body || {};
  if (typeof b.content !== 'string' || !b.content.trim()) {
    return bad(res, 'invalid_input', 'Memory content is required.');
  }
  const row = await memories.create(ctx(req), {
    content: b.content.trim().slice(0, 2000),
    category: typeof b.category === 'string' ? b.category.slice(0, 40) : 'Personal',
    kind: ['explicit', 'project', 'conversation', 'preference', 'inferred'].includes(b.kind) ? b.kind : 'explicit',
    pinned: !!b.pinned,
  });
  res.status(201).json({ memory: row });
}));

router.patch('/memories/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed memory id.');
  const row = await memories.update(ctx(req), req.params.id, req.body || {});
  if (!row) return bad(res, 'not_found', 'Memory not found.', 404);
  res.json({ memory: row });
}));

router.delete('/memories/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed memory id.');
  const ok = await memories.remove(ctx(req), req.params.id);
  if (!ok) return bad(res, 'not_found', 'Memory not found.', 404);
  res.json({ deleted: true });
}));

// ── provider settings + credentials ─────────────────────────────────────
router.get('/provider/settings', h(async (req, res) => {
  const settings = await providerSettings.get(ctx(req));
  res.json({ settings });
}));

router.put('/provider/settings', h(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if ('default_provider' in b) patch.default_provider = b.default_provider ? String(b.default_provider).slice(0, 40) : null;
  if ('default_model' in b) patch.default_model = b.default_model ? String(b.default_model).slice(0, 120) : null;
  if ('fallback_enabled' in b) patch.fallback_enabled = !!b.fallback_enabled;
  if ('free_only' in b) patch.free_only = !!b.free_only;
  if (!Object.keys(patch).length) return bad(res, 'invalid_input', 'No supported fields to update.');
  const settings = await providerSettings.upsert(ctx(req), patch);
  res.json({ settings });
}));

/** Only masked metadata ever leaves the server. */
router.get('/provider/credentials', h(async (req, res) => {
  const credentials = await providerCredentials.list(ctx(req));
  res.json({
    credentials: credentials.map((c) => ({
      id: c.id, provider: c.provider, label: c.label || 'default',
      masked: c.masked_hint, status: c.status, key_version: c.key_version,
      last_checked_at: c.last_checked_at || null, updated_at: c.updated_at,
    })),
  });
}));

router.put('/provider/credentials/:provider', h(async (req, res) => {
  const provider = String(req.params.provider || '').slice(0, 40);
  if (!/^[a-z0-9_-]+$/i.test(provider)) return bad(res, 'invalid_input', 'Malformed provider id.');
  const secret = req.body?.api_key;
  if (typeof secret !== 'string' || secret.trim().length < 8 || secret.length > 400) {
    return bad(res, 'invalid_input', 'A provider API key is required.');
  }
  if (!encryptionConfigured()) {
    return bad(res, 'encryption_unconfigured',
      'Server encryption is not configured (METALOID_ENCRYPTION_KEYS); refusing to store a key in the clear.',
      503);
  }
  const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim().slice(0, 40) : 'default';
  const saved = await providerCredentials.upsert(ctx(req), { provider, label, secret: secret.trim() });
  res.status(201).json({
    credential: {
      id: saved.id, provider: saved.provider, label: saved.label || label,
      masked: saved.masked_hint, status: saved.status,
    },
  });
}));

/**
 * Connection test. The secret is decrypted in memory for the outbound call
 * and never echoed — the response says only whether the provider accepted it.
 */
router.post('/provider/credentials/:provider/test', h(async (req, res) => {
  const provider = String(req.params.provider || '').slice(0, 40);
  if (!/^[a-z0-9_-]+$/i.test(provider)) return bad(res, 'invalid_input', 'Malformed provider id.');
  const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 40) : 'default';

  let secret = typeof req.body?.api_key === 'string' ? req.body.api_key.trim() : '';
  if (!secret) {
    if (!encryptionConfigured()) {
      return bad(res, 'encryption_unconfigured', 'Cannot read the stored key: encryption is unconfigured.', 503);
    }
    const stored = await providerCredentials.revealPlaintext?.(ctx(req), provider, label);
    if (!stored) return bad(res, 'not_found', 'No stored key for this provider.', 404);
    secret = stored.secret;
  }

  const result = await testProviderCredential(provider, secret);
  // only record a status for a key we actually hold
  if (!req.body?.api_key) {
    await providerCredentials.setStatus(ctx(req), provider, result.ok ? 'connected' : 'invalid', label);
  }
  res.json({
    ok: result.ok,
    provider,
    status: result.ok ? 'connected' : 'invalid',
    detail: result.detail,
    latency_ms: result.latency_ms,
  });
}));

router.delete('/provider/credentials/:provider', h(async (req, res) => {
  const provider = String(req.params.provider || '').slice(0, 40);
  const label = typeof req.query.label === 'string' ? req.query.label.slice(0, 40) : 'default';
  const ok = await providerCredentials.remove(ctx(req), provider, label);
  if (!ok) return bad(res, 'not_found', 'No such credential.', 404);
  res.json({ deleted: true });
}));

/**
 * Provider connection test.
 * OpenRouter's /key endpoint validates the key itself (no completion is
 * generated, so a test costs nothing and cannot leak a prompt).
 */
async function testProviderCredential(provider, secret) {
  const t0 = Date.now();
  if (provider !== 'openrouter') {
    return { ok: false, detail: `Unsupported provider "${provider}".`, latency_ms: 0 };
  }
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10000),
    });
    const latency_ms = Date.now() - t0;
    if (r.status === 401 || r.status === 403) return { ok: false, detail: 'Provider rejected this key.', latency_ms };
    if (!r.ok) return { ok: false, detail: `Provider returned ${r.status}.`, latency_ms };
    const j = await r.json().catch(() => ({}));
    const usage = j?.data?.usage;
    return {
      ok: true,
      detail: typeof usage === 'number' ? `Key accepted · $${usage.toFixed(4)} used` : 'Key accepted.',
      latency_ms,
    };
  } catch (e) {
    return {
      ok: false,
      detail: /timeout|aborted/i.test(String(e && e.message)) ? 'Provider did not respond in time.' : 'Could not reach the provider.',
      latency_ms: Date.now() - t0,
    };
  }
}

// ── usage ───────────────────────────────────────────────────────────────
router.get('/usage', h(async (req, res) => {
  res.json(await usage.list(ctx(req), limitQ(req.query)));
}));

router.post('/usage', h(async (req, res) => {
  const b = req.body || {};
  const row = await usage.record(ctx(req), {
    provider: typeof b.provider === 'string' ? b.provider.slice(0, 40) : null,
    model: typeof b.model === 'string' ? b.model.slice(0, 120) : null,
    request_id: typeof b.request_id === 'string' ? b.request_id.slice(0, 64) : null,
    task: typeof b.task === 'string' ? b.task.slice(0, 40) : null,
    tokens_in: Number.isFinite(b.tokens_in) ? b.tokens_in : null,
    tokens_out: Number.isFinite(b.tokens_out) ? b.tokens_out : null,
    latency_ms: Number.isFinite(b.latency_ms) ? b.latency_ms : null,
    status: ['ok', 'error', 'cancelled'].includes(b.status) ? b.status : 'ok',
  });
  res.status(201).json({ event: row });
}));

// ── agent tasks + tool events (shared with the future Android client) ───
router.get('/tasks', h(async (req, res) => {
  res.json(await tasks.list(ctx(req), { ...limitQ(req.query), status: req.query.status }));
}));

router.post('/tasks', h(async (req, res) => {
  const b = req.body || {};
  if (typeof b.type !== 'string' || !b.type.trim()) return bad(res, 'invalid_input', 'Task type is required.');
  const task = await tasks.create(ctx(req), {
    type: b.type.slice(0, 40),
    objective: typeof b.objective === 'string' ? b.objective.slice(0, 2000) : '',
    conversation_id: isUuid(b.conversation_id) ? b.conversation_id : null,
  });
  res.status(201).json({ task });
}));

router.get('/tasks/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed task id.');
  const task = await tasks.get(ctx(req), req.params.id);
  if (!task) return bad(res, 'not_found', 'Task not found.', 404);
  res.json({ task });
}));

router.patch('/tasks/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed task id.');
  const task = await tasks.update(ctx(req), req.params.id, req.body || {});
  if (!task) return bad(res, 'not_found', 'Task not found.', 404);
  res.json({ task });
}));

router.post('/tool-events', h(async (req, res) => {
  const b = req.body || {};
  if (typeof b.tool !== 'string' || !b.tool.trim()) return bad(res, 'invalid_input', 'Tool name is required.');
  const event = await toolEvents.record(ctx(req), {
    tool: b.tool, state: ['running', 'done', 'error'].includes(b.state) ? b.state : 'done',
    detail: typeof b.detail === 'string' ? b.detail.slice(0, 500) : null,
    conversation_id: isUuid(b.conversation_id) ? b.conversation_id : null,
    task_id: isUuid(b.task_id) ? b.task_id : null,
  });
  res.status(201).json({ event });
}));

// ── attachments (private storage) ───────────────────────────────────────
router.get('/attachments', h(async (req, res) => {
  res.json(await attachments.list(ctx(req), {
    ...limitQ(req.query),
    conversation_id: isUuid(req.query.conversation_id) ? req.query.conversation_id : null,
  }));
}));

router.post('/attachments', h(async (req, res) => {
  const b = req.body || {};
  if (typeof b.filename !== 'string' || !b.filename.trim()) {
    return bad(res, 'invalid_input', 'filename is required.');
  }
  const size = Number(b.size_bytes) || 0;
  if (size > 50 * 1024 * 1024) return bad(res, 'invalid_input', 'Attachments are limited to 50 MB.');
  const row = await attachments.create(ctx(req), {
    conversation_id: isUuid(b.conversation_id) ? b.conversation_id : null,
    filename: b.filename.trim().slice(0, 120),
    mime_type: typeof b.mime_type === 'string' ? b.mime_type.slice(0, 120) : 'application/octet-stream',
    size_bytes: size,
  });
  if (!row) return bad(res, 'not_found', 'Conversation not found.', 404);
  // The client uploads to this exact path; the DB row and the object key are
  // the same string, so a mismatch is impossible rather than merely unlikely.
  res.status(201).json({ attachment: row, upload: { bucket: row.bucket, path: row.storage_path } });
}));

router.patch('/attachments/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed attachment id.');
  const status = ['pending', 'ready', 'failed'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return bad(res, 'invalid_input', 'status must be pending|ready|failed.');
  const row = await attachments.setStatus(ctx(req), req.params.id, status);
  if (!row) return bad(res, 'not_found', 'Attachment not found.', 404);
  res.json({ attachment: row });
}));

/** Short-lived signed URL. Ownership is checked before signing. */
router.get('/attachments/:id/url', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed attachment id.');
  const expires = Math.min(Math.max(Number(req.query.expires) || 300, 30), 3600);
  const signed = await attachments.sign(ctx(req), req.params.id, expires);
  if (!signed) return bad(res, 'not_found', 'Attachment not found.', 404);
  if (signed.unavailable) return bad(res, 'storage_unavailable', signed.reason, 501);
  res.json(signed);
}));

router.delete('/attachments/:id', h(async (req, res) => {
  if (!isUuid(req.params.id)) return bad(res, 'invalid_input', 'Malformed attachment id.');
  const row = await attachments.remove(ctx(req), req.params.id);
  if (!row) return bad(res, 'not_found', 'Attachment not found.', 404);
  res.json({ deleted: true });
}));

// ── router-level guards ─────────────────────────────────────────────────
router.use((req, res) => res.status(404).json({ error: 'Unknown endpoint.', code: 'not_found' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[api/v1]', err.code || '', err.message);
  res.status(status).json({
    error: status >= 500 ? 'The data service is unavailable. Retry shortly.' : err.message,
    code: err.code || (status >= 500 ? 'db_error' : 'error'),
  });
});

/** Mounted behind requireAuth — every route above is authenticated. */
export function mountV1(app) {
  app.use('/api/v1', requireAuth, router);
  return { driver: driverName(), routes: router.stack.length };
}

export default router;
