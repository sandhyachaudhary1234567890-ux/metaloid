// Supabase data layer — Postgres mirrors of the file-store domains.
// Active ONLY when SUPABASE_DB=supabase (see dbMode()). Every function
// returns byte-compatible shapes with its file-mode twin so callers branch
// with a single `if (dbMode()) return supadb.x(...)` line.
// Pool: max 5 (conservative per spec), 8s timeouts, transaction-mode pooler.
// User ids: local `usr-…` AND Supabase `sb:<uuid>` both work — user_id
// columns accept either (text-typed in practice via uuid-or-text? NO:
// schema uses uuid. sb: ids are TEXT. See note on memories/users below).
//
// ID STRATEGY: file mode uses `mem-…`/`cred-…` string ids. Postgres tables
// use uuid PKs. In supabase mode all ids are uuids. Switching DB_MODE
// migrates CONTENT (ids change) — documented in DEPLOY.md, never silent.

import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function dbMode() {
  return process.env.SUPABASE_DB === 'supabase';
}

function poolUrl() {
  return process.env.SUPABASE_DB_POOL_URL || '';
}

export function dbConfigured() {
  return poolUrl().startsWith('postgresql://');
}

function getPool() {
  if (!pool) {
    if (!dbConfigured()) throw new Error('SUPABASE_DB_POOL_URL not configured.');
    pool = new Pool({
      connectionString: poolUrl(),
      max: 5, // conservative; measure before raising (spec §43)
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
      statement_timeout: 8000,
    });
    pool.on('error', (e) => {
      console.error('[supadb pool error]', String((e && e.message) || e).slice(0, 200));
    });
  }
  return pool;
}

async function q(text, params, op = 'query') {
  const t0 = Date.now();
  try {
    const r = await getPool().query(text, params);
    const ms = Date.now() - t0;
    if (ms > 2000) console.log(`[supadb slow] ${op} ${ms}ms`);
    return r;
  } catch (e) {
    console.error(`[supadb error] ${op}:`, String((e && e.message) || e).slice(0, 200));
    throw e;
  }
}

// ---------- profiles (mirrors profiles.js shape incl. DEFAULTS keys) ----------

const PROFILE_COLS = ['display_name', 'language', 'timezone', 'tone', 'verbosity', 'voice', 'voice_speed', 'proactivity', 'autonomy', 'theme', 'interests', 'goals', 'default_provider', 'fallback_providers', 'favorite_models', 'onboarding_done', 'plan'];
const PROFILE_KEYMAP = {
  displayName: 'display_name', language: 'language', timezone: 'timezone', tone: 'tone',
  verbosity: 'verbosity', voice: 'voice', voiceSpeed: 'voice_speed', proactivity: 'proactivity',
  autonomy: 'autonomy', theme: 'theme', interests: 'interests', goals: 'goals',
  defaultProvider: 'default_provider', fallbackProviders: 'fallback_providers',
  favoriteModels: 'favorite_models', onboardingDone: 'onboarding_done', plan: 'plan',
};

function rowToProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    displayName: row.display_name || '', language: row.language || 'auto',
    timezone: row.timezone || '', tone: row.tone || 'neutral',
    verbosity: row.verbosity || 'balanced', voice: row.voice || 'Natural English',
    voiceSpeed: Number(row.voice_speed ?? 1), proactivity: row.proactivity || 'assisted',
    autonomy: row.autonomy || 'assisted', theme: row.theme || 'obsidian',
    interests: row.interests || [], goals: row.goals || [],
    defaultProvider: row.default_provider || null,
    fallbackProviders: row.fallback_providers || [],
    favoriteModels: row.favorite_models || [],
    onboardingDone: !!row.onboarding_done,
    onboardedAt: row.onboarded_at || null, updatedAt: row.updated_at || null,
    plan: row.plan || 'free',
  };
}

export async function profileDelete(userId) {
  await q('delete from profiles where user_id = $1', [userId], 'profileDelete');
  return true;
}

export async function profileGet(userId) {
  const r = await q('select * from profiles where user_id = $1', [userId], 'profileGet');
  return rowToProfile(r.rows[0]);
}

export async function profileUpsert(userId, patch) {
  await q('insert into profiles (user_id) values ($1) on conflict (user_id) do nothing', [userId], 'profileEnsure');
  const sets = [];
  const updVals = [userId];
  let n = 2;
  for (const [k, col] of Object.entries(PROFILE_KEYMAP)) {
    if (patch[k] === undefined) continue;
    sets.push(`${col} = $${n++}`);
    updVals.push(patch[k]);
  }
  sets.push('updated_at = now()');
  if (patch.onboardedAt) {
    sets.push(`onboarded_at = $${n++}`);
    updVals.push(patch.onboardedAt);
  }
  const r = await q(`update profiles set ${sets.join(', ')} where user_id = $1 returning *`, updVals, 'profileUpsert');
  if (!r.rows.length) return profileGet(userId);
  return rowToProfile(r.rows[0]);
}

// ---------- credentials (mirrors credentialVault shapes) ----------

function encField(e) {
  return JSON.stringify(e);
}
export function decField(s) {
  try {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    if (o && o.salt && o.iv && o.encrypted && o.authTag) return o;
    return null;
  } catch {
    return null;
  }
}

function credRowToPublic(r) {
  return {
    id: r.id, providerId: r.provider_id, isActive: r.is_active,
    createdAt: r.created_at, lastRotatedAt: r.last_rotated_at,
    rotationCount: r.rotation_count,
  };
}

export async function credStore(userId, providerId, encryptedObj, metadata = {}, redacted = '****') {
  const now = new Date().toISOString();
  void metadata;
  const existing = await q('select id, rotation_count from user_provider_credentials where user_id=$1 and provider_id=$2', [userId, providerId], 'credStoreRead');
  if (existing.rows.length) {
    const prev = existing.rows[0].rotation_count || 0;
    const r = await q(
      'update user_provider_credentials set encrypted_secret=$1, is_active=true, last_rotated_at=null, rotation_count=0, updated_at=now() where user_id=$2 and provider_id=$3 returning *',
      [encField(encryptedObj), userId, providerId], 'credStoreUpdate'
    );
    await credAudit(userId, providerId, 'CREDENTIAL_ROTATED', { previousRotationCount: prev, newRotationCount: 0, id: r.rows[0].id });
    const pub = credRowToPublic(r.rows[0]);
    return { ...pub, redacted, createdAt: pub.createdAt || now };
  }
  const r = await q(
    `insert into user_provider_credentials (user_id, provider_id, encrypted_secret, is_active, last_rotated_at, rotation_count)
     values ($1,$2,$3,true,null,0) returning *`,
    [userId, providerId, encField(encryptedObj)], 'credStore'
  );
  await credAudit(userId, providerId, 'CREDENTIAL_STORED', { id: r.rows[0].id });
  const pub = credRowToPublic(r.rows[0]);
  return { ...pub, redacted, createdAt: pub.createdAt || now };
}

export async function credGet(userId, providerId) {
  const r = await q('select * from user_provider_credentials where user_id=$1 and provider_id=$2 and is_active=true', [userId, providerId], 'credGet');
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id, providerId: row.provider_id, credential: row.encrypted_secret,
    metadata: {}, isActive: row.is_active,
    lastRotatedAt: row.last_rotated_at, rotationCount: row.rotation_count,
  };
}

export async function credList(userId) {
  const r = await q('select * from user_provider_credentials where user_id=$1 and is_active=true order by created_at', [userId], 'credList');
  return r.rows.map(credRowToPublic);
}

export async function credDelete(userId, providerId) {
  const r = await q('delete from user_provider_credentials where user_id=$1 and provider_id=$2 returning id', [userId, providerId], 'credDelete');
  if (!r.rows.length) return { ok: false, error: 'Credential not found' };
  await credAudit(userId, providerId, 'CREDENTIAL_DELETED', {});
  return { ok: true };
}

export async function credRotateById(userId, credId, encryptedObj, redacted = '****') {
  const cur = await q('select * from user_provider_credentials where id=$1 and user_id=$2', [credId, userId], 'credRotateRead');
  if (!cur.rows.length) return { ok: false, error: 'Credential not found' };
  const prev = cur.rows[0].rotation_count || 0;
  await q('update user_provider_credentials set encrypted_secret=$1, last_rotated_at=now(), rotation_count=$2, updated_at=now() where id=$3', [encField(encryptedObj), prev + 1, credId], 'credRotateWrite');
  await credAudit(userId, cur.rows[0].provider_id, 'CREDENTIAL_ROTATED', { previousRotationCount: prev, newRotationCount: prev + 1 });
  return { ok: true, rotationCount: prev + 1, redacted };
}

export async function credTestStatus(userId, providerId, status, metadata = {}) {
  const r = await q('select id from user_provider_credentials where user_id=$1 and provider_id=$2', [userId, providerId], 'credTestRead');
  if (!r.rows.length) return { ok: false, error: 'Credential not found' };
  await q('update user_provider_credentials set last_tested_at=now(), last_test_status=$1, metadata=coalesce(metadata,\'{}\'::jsonb) || $2, updated_at=now() where user_id=$3 and provider_id=$4', [status, JSON.stringify({ testMetadata: metadata }), userId, providerId], 'credTestWrite');
  await credAudit(userId, providerId, 'CREDENTIAL_TESTED', { status });
  return { ok: true, status };
}

export async function credTestGet(userId, providerId) {
  const r = await q('select provider_id, last_tested_at, last_test_status, metadata from user_provider_credentials where user_id=$1 and provider_id=$2', [userId, providerId], 'credTestGet');
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    providerId,
    lastTestedAt: row.last_tested_at || null,
    testStatus: row.last_test_status || 'unknown',
    testMetadata: (row.metadata && row.metadata.testMetadata) || {},
  };
}

export async function credAudit(userId, providerId, action, detail = {}) {
  try {
    await q('insert into credential_audit (user_id, provider_id, action, detail) values ($1,$2,$3,$4)', [userId, providerId, action, JSON.stringify(detail)], 'credAudit');
  } catch { /* audit never breaks the op */ }
}

export async function credAuditLog(userId, providerId) {
  const r = await q('select id, user_id, provider_id, action, detail, created_at as timestamp from credential_audit where user_id=$1 and ($2::text is null or provider_id=$2) order by created_at desc limit 200', [userId, providerId || null], 'credAuditLog');
  return r.rows;
}

export async function credDeleteAll(userId) {
  const r = await q('delete from user_provider_credentials where user_id=$1 returning id', [userId], 'credDeleteAll');
  await credAudit(userId, null, 'ALL_USER_CREDENTIALS_DELETED', { count: r.rows.length });
  return r.rows.length;
}

// ---------- usage + plans ----------

export async function usageRecord(userId, kind, amount = 1, extra = {}) {
  const n = Math.min(Math.max(1, Math.floor(amount) || 1), 100);
  for (let i = 0; i < n; i++) {
    await q('insert into usage_events (user_id, kind, provider_id, tokens, ms) values ($1,$2,$3,$4,$5)', [userId, kind, extra.providerId || null, extra.tokens || 0, extra.ms || 0], 'usageRecord');
  }
  return true;
}

export async function usageCounts(userId, kind) {
  const day = await q(`select count(*)::int c from usage_events where user_id=$1 and kind=$2 and created_at >= date_trunc('day', now())`, [userId, kind], 'usageDay');
  const month = await q(`select count(*)::int c, coalesce(sum(tokens),0)::int t from usage_events where user_id=$1 and kind=$2 and created_at >= date_trunc('month', now())`, [userId, kind], 'usageMonth');
  return { day: day.rows[0].c, month: month.rows[0].c, monthTokens: month.rows[0].t };
}

export async function planGet(userId) {
  const p = await profileGet(userId);
  return (p && p.plan) || 'free';
}

export async function planSet(userId, plan) {
  await profileUpsert(userId, { plan });
  return plan;
}

export async function usageDelete(userId) {
  await q('delete from usage_events where user_id=$1', [userId], 'usageDelete');
  await profileUpsert(userId, { plan: 'free' });
  return true;
}

// ---------- memories ----------

function memRow(r) {
  return {
    id: r.id, userId: r.user_id, class: r.class, content: r.content,
    source: r.source, confidence: r.confidence, scope: r.scope,
    workspaceId: r.workspace_id, projectId: r.project_id,
    at: r.created_at, lastVerified: r.last_verified_at || null,
    lastUsed: r.last_used_at || null,
  };
}

export async function memRemember({ userId, cls = 'semantic', content, source = 'user', confidence = 'medium', scope = 'personal', workspaceId = null }) {
  const text = String(content || '').slice(0, 1000);
  if (!text) return { ok: false, error: 'Empty content.' };
  const conf = ['low', 'medium', 'high'].includes(confidence) ? confidence : 'medium';
  const r = await q(
    'insert into memories (user_id, class, content, source, confidence, scope, workspace_id) values ($1,$2,$3,$4,$5,$6,$7) returning *',
    [userId, cls, text, source, conf, scope, workspaceId || null], 'memRemember'
  );
  return { ok: true, record: memRow(r.rows[0]) };
}

export async function memRecall(userId, { cls, query = '', limit = 20, workspaceId } = {}) {
  const lim = Math.min(Number(limit) || 20, 50);
  const conds = ['user_id = $1'];
  const vals = [userId];
  let i = 2;
  if (cls) {
    conds.push(`class = $${i++}`);
    vals.push(cls);
  }
  if (query) {
    conds.push(`content ilike $${i++}`);
    vals.push(`%${String(query).replace(/[%_\\]/g, '\\$&')}%`);
  }
  if (workspaceId !== undefined) {
    if (workspaceId) {
      conds.push(`workspace_id = $${i++}`);
      vals.push(workspaceId);
    } else {
      conds.push('workspace_id is null');
    }
  }
  vals.push(lim);
  const r = await q(`select * from memories where ${conds.join(' and ')} and deleted_at is null order by created_at desc, id desc limit $${i}`, vals, 'memRecall');
  const out = r.rows.map(memRow);
  if (out.length) {
    await q('update memories set last_used_at = now() where id = any($1)', [out.map((m) => m.id)], 'memTouch');
    for (const m of out) m.lastUsed = new Date().toISOString();
  }
  return out;
}

export async function memUpdate(userId, id, patch = {}) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (typeof patch.content === 'string' && patch.content.trim()) {
    sets.push(`content = $${i++}`);
    vals.push(patch.content.slice(0, 1000));
  }
  if (['low', 'medium', 'high'].includes(patch.confidence)) {
    sets.push(`confidence = $${i++}`);
    vals.push(patch.confidence);
  }
  if (!sets.length) {
    const cur = await q('select * from memories where id=$1 and user_id=$2 and deleted_at is null', [id, userId], 'memRead');
    return cur.rows.length ? { ok: true, record: memRow(cur.rows[0]) } : { ok: false, error: 'Unknown memory.' };
  }
  vals.push(id, userId);
  const r = await q(`update memories set ${sets.join(', ')} where id=$${i++} and user_id=$${i++} and deleted_at is null returning *`, vals, 'memUpdate');
  if (!r.rows.length) return { ok: false, error: 'Unknown memory.' };
  return { ok: true, record: memRow(r.rows[0]) };
}

export async function memForget(userId, id) {
  const r = await q('update memories set deleted_at = now() where id=$1 and user_id=$2 and deleted_at is null returning id', [id, userId], 'memForget');
  if (!r.rows.length) return { ok: false, error: 'Unknown memory.' };
  return { ok: true };
}

export async function memForgetAll(userId) {
  const r = await q('update memories set deleted_at = now() where user_id=$1 and deleted_at is null returning id', [userId], 'memForgetAll');
  return { ok: true, deleted: r.rows.length };
}

export async function memExport(userId) {
  const r = await q('select * from memories where user_id=$1 and deleted_at is null order by created_at desc', [userId], 'memExport');
  return r.rows.map(memRow);
}

export async function memStats(userId) {
  const r = await q(`select class, count(*)::int c from memories where user_id=$1 and deleted_at is null group by class`, [userId], 'memStats');
  const byClass = {};
  let total = 0;
  for (const row of r.rows) {
    byClass[row.class] = row.c;
    total += row.c;
  }
  return { total, byClass };
}

// ---------- missions (full task graph; data jsonb holds tasks/outputs/timeline) ----------

function msnRow(r) {
  const d = r.data || {};
  return {
    id: r.id, userId: r.user_id, objective: r.objective, status: r.status,
    skillIds: r.skill_ids || [],
    priority: d.priority || 'normal',
    constraints: d.constraints || [],
    tasks: d.tasks || [],
    outputs: d.outputs || {}, decisions: d.decisions || [], errors: d.errors || [],
    checkpoints: d.checkpoints || [], timeline: d.timeline || [],
    budgets: d.budgets || { maxMs: 120000, maxSteps: 25 },
    createdAt: d.createdAt || r.created_at, updatedAt: d.updatedAt || r.updated_at,
    _flags: d._flags || { paused: false, cancelled: false },
  };
}

function msnData(m) {
  return {
    priority: m.priority, constraints: m.constraints, tasks: m.tasks,
    outputs: m.outputs, decisions: m.decisions, errors: m.errors,
    checkpoints: m.checkpoints, timeline: m.timeline, budgets: m.budgets,
    createdAt: m.createdAt, updatedAt: m.updatedAt, _flags: m._flags,
  };
}

export async function msnInsert(m) {
  await q(
    'insert into missions (id, user_id, objective, status, skill_ids, data) values ($1,$2,$3,$4,$5,$6)',
    [m.id, m.userId, m.objective, m.status, m.skillIds || [], JSON.stringify(msnData(m))], 'msnInsert'
  );
  // cap per user (file parity: 100)
  await q(`delete from missions where user_id=$1 and id not in (select id from missions where user_id=$1 order by created_at desc limit 100)`, [m.userId], 'msnTrim');
  return true;
}

export async function msnGet(userId, id) {
  const r = await q('select * from missions where id=$1 and user_id=$2', [id, userId], 'msnGet');
  return r.rows.length ? msnRow(r.rows[0]) : null;
}

export async function msnList(userId) {
  const r = await q('select * from missions where user_id=$1 order by created_at desc', [userId], 'msnList');
  return r.rows.map(msnRow);
}

export async function msnLatestActive(userId) {
  const r = await q(
    `select * from missions where user_id=$1 and status in ('QUEUED','RUNNING','PAUSED','BLOCKED') order by created_at desc limit 1`,
    [userId], 'msnLatestActive'
  );
  return r.rows.length ? msnRow(r.rows[0]) : null;
}

export async function msnSave(m) {
  m.updatedAt = new Date().toISOString();
  await q(
    'update missions set objective=$1, status=$2, skill_ids=$3, data=$4, updated_at=now() where id=$5',
    [m.objective, m.status, m.skillIds || [], JSON.stringify(msnData(m)), m.id], 'msnSave'
  );
  return true;
}

/** Live flags for a running mission (pause/cancel across processes). */
export async function msnFlags(userId, id) {
  const r = await q(`select data->'_flags' as flags from missions where id=$1 and user_id=$2`, [id, userId], 'msnFlags');
  return (r.rows[0] && r.rows[0].flags) || { paused: false, cancelled: false };
}

export async function msnDeleteUser(userId) {
  const r = await q('delete from missions where user_id=$1 returning id', [userId], 'msnDeleteUser');
  return r.rows.length;
}

// ---------- world (entities + relations) ----------

// mirrors world.js normalizeName (kept local: importing world.js here
// would couple the modules; matching semantics stay identical)
function wnorm(s) {
  return String(s || '').toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/[,.\s]+(inc|llc|ltd|pvt|corp|co|gmbh)\.?$/i, '')
    .replace(/[^a-z0-9.-]/g, '').trim();
}

export async function worldUpsert(userId, { type, name, aliases = [], source = 'unknown', confidence = 'medium' }) {
  const norm = wnorm(name);
  const cur = await q('select * from world_entities where user_id=$1 and type=$2', [userId, type], 'worldFindType');
  let ent = cur.rows.find((e) => wnorm(e.name) === norm);
  const now = new Date().toISOString();
  if (ent) {
    const merged = [...new Set([...(ent.aliases || []), ...aliases])];
    const r = await q('update world_entities set aliases=$1, last_verified=$2 where id=$3 returning *', [merged, now, ent.id], 'worldTouch');
    ent = r.rows[0];
  } else {
    const id = `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await q(
      'insert into world_entities (id, user_id, type, name, aliases, sources, confidence, first_seen, last_verified, timeline) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) returning *',
      [id, userId, type, name, aliases, [source], confidence, now, []], 'worldInsert'
    );
    ent = r.rows[0];
  }
  if (!ent.sources.includes(source)) {
    ent.sources.push(source);
    await q('update world_entities set sources=$1 where id=$2', [ent.sources, ent.id], 'worldSources');
  }
  return worldEnt(ent);
}

function worldEnt(e) {
  return {
    id: e.id, userId: e.user_id, type: e.type, name: e.name,
    aliases: e.aliases || [], sources: e.sources || [], confidence: e.confidence,
    firstSeen: e.first_seen, lastVerified: e.last_verified, timeline: e.timeline || [],
  };
}

export async function worldRelate(userId, fromId, toId, rel, { source = 'unknown', confidence = 'medium', evidence = '' } = {}) {
  const f = await q('select id from world_entities where id=$1 and user_id=$2', [fromId, userId], 'worldRelFrom');
  const t = await q('select id from world_entities where id=$1 and user_id=$2', [toId, userId], 'worldRelTo');
  if (!f.rows.length || !t.rows.length) return { ok: false, error: 'Unknown entity.' };
  const r = await q(
    'insert into world_relations (user_id, from_id, to_id, rel, source, confidence, evidence) values ($1,$2,$3,$4,$5,$6,$7) returning *',
    [userId, fromId, toId, rel, source, confidence, String(evidence).slice(0, 300)], 'worldRelate'
  );
  const e = r.rows[0];
  return { ok: true, edge: { from: e.from_id, to: e.to_id, rel: e.rel, userId, source: e.source, confidence: e.confidence, evidence: e.evidence, at: e.created_at } };
}

export async function worldNeighbors(userId, id, depth = 1) {
  const root = await q('select id from world_entities where id=$1 and user_id=$2', [id, userId], 'worldRoot');
  if (!root.rows.length) return { entities: [], relations: [] };
  const seen = new Set([id]);
  let frontier = [id];
  const edges = [];
  for (let d = 0; d < depth; d++) {
    const next = [];
    const rel = await q('select * from world_relations where user_id=$1 and (from_id = any($2) or to_id = any($2))', [userId, frontier], 'worldRelScan');
    for (const e of rel.rows) {
      if (frontier.includes(e.from_id) && !seen.has(e.to_id)) { seen.add(e.to_id); next.push(e.to_id); }
      else if (frontier.includes(e.to_id) && !seen.has(e.from_id)) { seen.add(e.from_id); next.push(e.from_id); }
      else continue;
      edges.push({ from: e.from_id, to: e.to_id, rel: e.rel, userId, source: e.source, confidence: e.confidence, evidence: e.evidence, at: e.created_at });
    }
    frontier = next;
  }
  const ents = await q('select * from world_entities where user_id=$1 and id = any($2)', [userId, [...seen]], 'worldEntScan');
  return { entities: ents.rows.map(worldEnt), relations: edges };
}

export async function worldStats(userId) {
  const e = await q('select count(*)::int c from world_entities where user_id=$1', [userId], 'worldStatE');
  const r = await q('select count(*)::int c from world_relations where user_id=$1', [userId], 'worldStatR');
  return { entities: e.rows[0].c, relations: r.rows[0].c };
}

export async function worldFind(userId, query = '', type) {
  const qq = String(query || '').toLowerCase();
  const conds = ['user_id=$1'];
  const vals = [userId];
  let i = 2;
  if (type) {
    conds.push(`type=$${i++}`);
    vals.push(type);
  }
  if (qq) {
    conds.push(`(lower(name) like $${i} or exists (select 1 from jsonb_array_elements_text(to_jsonb(aliases)) a where lower(a) like $${i}))`);
    vals.push(`%${qq.replace(/[%_\\]/g, '\\$&')}%`);
    i += 1;
  }
  vals.push(50);
  const r = await q(`select * from world_entities where ${conds.join(' and ')} limit $${i}`, vals, 'worldFind');
  return r.rows.map(worldEnt);
}

export async function worldDeleteUser(userId) {
  const e = await q('delete from world_entities where user_id=$1 returning id', [userId], 'worldDelE');
  const r = await q('delete from world_relations where user_id=$1 returning id', [userId], 'worldDelR');
  return e.rows.length + r.rows.length;
}

// ---------- skills (full package in data jsonb; indexed cols for scoping) ----------

const SKILL_COLS = ['id', 'user_id', 'scope', 'workspace_id', 'project_id', 'source', 'status', 'created_at', 'updated_at', 'last_used_at', 'use_count'];

function skillRow(s) {
  const { id, userId, scope, workspaceId, projectId, source, status, createdAt, updatedAt, lastUsedAt, useCount, ...data } = s;
  return {
    id, user_id: userId, scope, workspace_id: workspaceId || null, project_id: projectId || null,
    source, status, created_at: createdAt, updated_at: updatedAt,
    last_used_at: lastUsedAt || null, use_count: useCount || 0, data,
  };
}

function rowToSkill(r) {
  return {
    ...(r.data || {}),
    id: r.id, userId: r.user_id, scope: r.scope,
    workspaceId: r.workspace_id, projectId: r.project_id,
    source: r.source, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at, useCount: r.use_count || 0,
  };
}

function skillVisible(s, ctx = {}) {
  if (s.status === 'deleted') return false;
  if (s.scope === 'global') return true;
  if (s.userId !== ctx.userId) return false;
  if (s.scope === 'user') return true;
  if (s.scope === 'workspace') return !ctx.workspaceId || s.workspaceId === ctx.workspaceId;
  if (s.scope === 'project') return !ctx.projectId || s.projectId === ctx.projectId;
  return false;
}

export async function skillInsert(s) {
  const r = skillRow(s);
  await q(
    'insert into skills (id, user_id, scope, workspace_id, project_id, source, status, data, created_at, updated_at, last_used_at, use_count) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [r.id, r.user_id, r.scope, r.workspace_id, r.project_id, r.source, r.status, JSON.stringify(r.data), r.created_at, r.updated_at, r.last_used_at, r.use_count],
    'skillInsert'
  );
  return true;
}

export async function skillSave(s) {
  const r = skillRow(s);
  await q(
    'update skills set user_id=$2, scope=$3, workspace_id=$4, project_id=$5, source=$6, status=$7, data=$8, updated_at=now(), last_used_at=$9, use_count=$10 where id=$1',
    [r.id, r.user_id, r.scope, r.workspace_id, r.project_id, r.source, r.status, JSON.stringify(r.data), r.last_used_at, r.use_count],
    'skillSave'
  );
  return true;
}

export async function skillGet(userId, id, ctx = {}) {
  const r = await q('select * from skills where id=$1', [id], 'skillGet');
  if (!r.rows.length) return null;
  const s = rowToSkill(r.rows[0]);
  if (s.status === 'deleted') return null;
  if (s.scope === 'global') return s;
  if (s.userId !== userId) return null;
  if (s.scope === 'workspace' && ctx.workspaceId && s.workspaceId !== ctx.workspaceId) return null;
  if (s.scope === 'project' && ctx.projectId && s.projectId !== ctx.projectId) return null;
  return s;
}

export async function skillList(userId, ctx = {}) {
  const r = await q('select * from skills where user_id=$1 or user_id=$2 or scope=$3', [userId, 'system', 'global'], 'skillList');
  return r.rows.map(rowToSkill).filter((s) => skillVisible(s, { ...ctx, userId }));
}

export async function skillDeleteUser(userId) {
  const r = await q('delete from skills where user_id=$1 returning id', [userId], 'skillDeleteUser');
  return r.rows.length;
}

// ---------- workspaces ----------

const SYSTEM_WORKSPACES = ['Personal', 'School', 'Work', 'Coding', 'Research', 'Content', 'Business'];

function wsRow(r) {
  return {
    id: r.id, userId: r.user_id, name: r.name, kind: r.kind,
    instructions: r.instructions || '', files: r.files || [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function wsList(userId) {
  const r = await q('select * from workspaces where user_id=$1 order by created_at', [userId], 'wsList');
  return r.rows.map(wsRow);
}

export async function wsGet(userId, id) {
  const r = await q('select * from workspaces where id=$1 and user_id=$2', [id, userId], 'wsGet');
  return r.rows.length ? wsRow(r.rows[0]) : null;
}

export async function wsCreate(userId, { name, kind = 'custom', instructions = '' }) {
  const n = String(name || '').trim().slice(0, 60);
  if (!n) return { ok: false, error: 'Workspace name required.' };
  const count = await q('select count(*)::int c from workspaces where user_id=$1', [userId], 'wsCount');
  if (count.rows[0].c >= 50) return { ok: false, error: 'Workspace limit reached.' };
  const id = `wsp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const r = await q(
    'insert into workspaces (id, user_id, name, kind, instructions, files, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$7) returning *',
    [id, userId, n, SYSTEM_WORKSPACES.includes(n) ? 'system' : String(kind).slice(0, 20), String(instructions || '').slice(0, 2000), [], now],
    'wsCreate'
  );
  return { ok: true, workspace: wsRow(r.rows[0]) };
}

export async function wsUpdate(userId, id, patch = {}) {
  const w = await wsGet(userId, id);
  if (!w) return null;
  const sets = [];
  const vals = [];
  let i = 1;
  if (typeof patch.name === 'string' && patch.name.trim()) {
    sets.push(`name = $${i++}`);
    vals.push(patch.name.trim().slice(0, 60));
  }
  if (typeof patch.instructions === 'string') {
    sets.push(`instructions = $${i++}`);
    vals.push(patch.instructions.slice(0, 2000));
  }
  sets.push('updated_at = now()');
  vals.push(id, userId);
  const r = await q(`update workspaces set ${sets.join(', ')} where id=$${i++} and user_id=$${i++} returning *`, vals, 'wsUpdate');
  return r.rows.length ? wsRow(r.rows[0]) : null;
}

export async function wsDelete(userId, id) {
  const r = await q('delete from workspaces where id=$1 and user_id=$2 returning id', [id, userId], 'wsDelete');
  return r.rows.length > 0;
}

export async function wsDeleteUser(userId) {
  await q('delete from workspaces where user_id=$1', [userId], 'wsDeleteUser');
  return true;
}

// ---------- devices (+ pairing codes) ----------

function devRow(r) {
  return {
    id: r.id, userId: r.user_id, name: r.name,
    capabilities: r.capabilities || [],
    pairedAt: r.paired_at, lastSeenAt: r.last_seen_at, revoked: !!r.revoked,
  };
}

export async function devList(userId) {
  const r = await q('select * from devices where user_id=$1 and revoked=false order by paired_at', [userId], 'devList');
  return r.rows.map(devRow);
}

export async function devRevoke(userId, id) {
  const r = await q('update devices set revoked=true where id=$1 and user_id=$2 returning id', [id, userId], 'devRevoke');
  return r.rows.length > 0;
}

export async function devAuthorize(userId, deviceId, capability) {
  const r = await q('select * from devices where id=$1 and user_id=$2 and revoked=false', [deviceId, userId], 'devAuth');
  const d = r.rows[0];
  if (!d) return { ok: false, error: 'Unknown or unpaired device.' };
  if ((d.capabilities || []).length && !d.capabilities.includes(capability)) {
    return { ok: false, error: `Device not authorized for "${capability}".` };
  }
  await q('update devices set last_seen_at=now() where id=$1', [deviceId], 'devSeen');
  return { ok: true, device: { id: d.id, name: d.name } };
}

export async function devDeleteUser(userId) {
  await q('delete from devices where user_id=$1', [userId], 'devDeleteUser');
  await q('delete from pairing_codes where user_id=$1', [userId], 'devPairClean');
  return true;
}

export async function devPairRequest(userId, { deviceName = '', capabilities = [] } = {}) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await q('delete from pairing_codes where expires_at < now()', [], 'devPairGc');
  await q(
    'insert into pairing_codes (code, user_id, device_name, capabilities, expires_at) values ($1,$2,$3,$4,$5) on conflict (code, user_id) do update set expires_at=excluded.expires_at, device_name=excluded.device_name, capabilities=excluded.capabilities',
    [code, userId, String(deviceName).slice(0, 80), Array.isArray(capabilities) ? capabilities.map(String).slice(0, 20) : [], expires],
    'devPairRequest'
  );
  return { code, expiresInSec: 600 };
}

export async function devPairConfirm(userId, code, { deviceId = null } = {}) {
  const r = await q('select * from pairing_codes where code=$1 and user_id=$2 and expires_at > now()', [String(code), userId], 'devPairRead');
  if (!r.rows.length) return { ok: false, error: 'Invalid or expired pairing code.' };
  const p = r.rows[0];
  await q('delete from pairing_codes where code=$1 and user_id=$2', [String(code), userId], 'devPairTake');
  const id = typeof deviceId === 'string' && deviceId ? deviceId.slice(0, 80) : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const ins = await q(
    'insert into devices (id, user_id, name, capabilities, paired_at, revoked) values ($1,$2,$3,$4,$5,false) returning *',
    [id, userId, p.device_name || 'Unnamed device', p.capabilities || [], now], 'devPairInsert'
  );
  return { ok: true, device: devRow(ins.rows[0]) };
}

/** Crash recovery at boot: stale RUNNING → QUEUED with a checkpoint note. */
export async function msnRecover() {
  const r = await q(`update missions set status='QUEUED', updated_at=now(),
    data = jsonb_set(data, '{timeline}', coalesce(data->'timeline','[]'::jsonb) || jsonb_build_object('at', now()::text, 'event', 'Recovered', 'detail', 'Gateway restarted; mission re-queued from checkpoint.'))
    where status='RUNNING' returning id`, [], 'msnRecover');
  return r.rows.length;
}

// ---------- artifacts metadata (bytes live in Storage, never in rows) ----------

function artRow(r) {
  return {
    id: r.id, userId: r.user_id, kind: r.kind, name: r.name,
    projectId: r.project_id, workspaceId: r.workspace_id,
    taskId: r.task_id, conversationId: r.conversation_id,
    status: r.status, version: r.version,
    verification: r.verification, renders: r.renders || [],
    timeline: r.timeline || [], versions: r.versions || [],
    repairs: r.repairs || 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
    deleted: !!r.deleted,
  };
}

function artCols(a) {
  return [a.id, a.userId, a.kind, a.name, a.projectId || null, a.workspaceId || null,
    a.taskId || null, a.conversationId || null, a.status, a.version,
    JSON.stringify(a.verification || null), JSON.stringify(a.renders || []),
    JSON.stringify(a.timeline || []), JSON.stringify(a.versions || []), !!a.deleted];
}

export async function artInsert(a) {
  await q(
    'insert into artifacts (id, user_id, kind, name, project_id, workspace_id, task_id, conversation_id, status, version, verification, renders, timeline, versions, deleted) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
    artCols(a), 'artInsert'
  );
  return true;
}

export async function artSave(a) {
  a.updatedAt = new Date().toISOString();
  await q(
    'update artifacts set kind=$2, name=$3, project_id=$4, workspace_id=$5, task_id=$6, conversation_id=$7, status=$8, version=$9, verification=$10, renders=$11, timeline=$12, versions=$13, deleted=$14, repairs=$15, updated_at=now() where id=$1',
    [a.id, a.kind, a.name, a.projectId || null, a.workspaceId || null, a.taskId || null, a.conversationId || null, a.status, a.version,
      JSON.stringify(a.verification || null), JSON.stringify(a.renders || []), JSON.stringify(a.timeline || []), JSON.stringify(a.versions || []), !!a.deleted, a.repairs || 0],
    'artSave'
  );
  return true;
}

export async function artGet(userId, id) {
  const r = await q('select * from artifacts where id=$1 and user_id=$2 and deleted=false', [id, userId], 'artGet');
  return r.rows.length ? artRow(r.rows[0]) : null;
}

export async function artList(userId, scope = {}) {
  const conds = ['user_id=$1', 'deleted=false'];
  const vals = [userId];
  let i = 2;
  if (scope.projectId) {
    conds.push(`project_id=$${i++}`);
    vals.push(scope.projectId);
  }
  if (scope.workspaceId) {
    conds.push(`workspace_id=$${i++}`);
    vals.push(scope.workspaceId);
  }
  const r = await q(`select * from artifacts where ${conds.join(' and ')} order by updated_at desc`, vals, 'artList');
  return r.rows.map(artRow);
}

export async function artDeleteUser(userId) {
  // bytes deleted by caller via storageDel per artifact (needs ids first)
  const r = await q('delete from artifacts where user_id=$1 returning id', [userId], 'artDeleteUser');
  return r.rows.map((x) => x.id);
}

// ---------- Supabase Storage (private bucket `artifacts`) ----------

function storageCfg() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Artifact bytes unavailable: storage is not configured on this gateway.');
  return { url, key };
}

function artPath(userId, id, version) {
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 120);
  return `${safe(userId)}/${safe(id)}.v${Number(version) || 1}.bin`;
}

export async function artBytesPut(userId, id, version, buf, mime) {
  const { url, key } = storageCfg();
  const r = await fetch(`${url}/storage/v1/object/artifacts/${artPath(userId, id, version)}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': mime || 'application/octet-stream' },
    body: buf,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Storage upload failed (${r.status}).`);
  return true;
}

export async function artBytesGet(userId, id, version) {
  const { url, key } = storageCfg();
  const r = await fetch(`${url}/storage/v1/object/artifacts/${artPath(userId, id, version)}`, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error('Artifact bytes not found.');
  return Buffer.from(await r.arrayBuffer());
}

export async function artBytesDel(userId, ids) {
  const { url, key } = storageCfg();
  // list versions per artifact then remove
  for (const id of ids) {
    try {
      const list = await fetch(`${url}/storage/v1/object/list/artifacts`, {
        method: 'POST',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: `${String(userId).replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 120)}/${String(id).replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 120)}` }),
        signal: AbortSignal.timeout(30000),
      }).then((x) => x.json()).catch(() => []);
      const names = (Array.isArray(list) ? list : []).map((f) => f.name).filter(Boolean);
      if (names.length) {
        await fetch(`${url}/storage/v1/object/artifacts`, {
          method: 'DELETE',
          headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: names.map((n) => `${String(userId).replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 120)}/${n}`) }),
          signal: AbortSignal.timeout(30000),
        }).catch(() => {});
      }
    } catch { /* best-effort cleanup */ }
  }
  return true;
}

// ---------- jobs (shared queue for multi-instance correctness) ----------

export async function jobSubmit(userId, kind, label) {
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await q(
    'insert into jobs (id, user_id, kind, label, status) values ($1,$2,$3,$4,\'queued\') returning *',
    [id, userId, kind, String(label || kind).slice(0, 160)], 'jobSubmit'
  );
  const j = r.rows[0];
  return { id: j.id, userId: j.user_id, kind: j.kind, label: j.label, status: j.status, createdAt: j.created_at, startedAt: null, endedAt: null, result: null, error: null };
}

/** Claim ONE queued job atomically (SKIP LOCKED) for cross-instance pump. */
export async function jobClaim() {
  const r = await q(
    `update jobs set status='running', started_at=now() where id = (
       select id from jobs where status='queued' order by created_at limit 1 for update skip locked
     ) returning *`,
    [], 'jobClaim'
  );
  if (!r.rows.length) return null;
  const j = r.rows[0];
  return { id: j.id, userId: j.user_id, kind: j.kind, label: j.label };
}

export async function jobFinish(id, ok, result = null, error = '') {
  await q('update jobs set status=$2, ended_at=now(), result=$3, error=$4 where id=$1',
    [id, ok ? 'completed' : 'failed', result ? JSON.stringify(result).slice(0, 5000) : null, String(error || '').slice(0, 300)], 'jobFinish');
  return true;
}

export async function jobGet(userId, id) {
  const r = await q('select * from jobs where id=$1 and user_id=$2', [id, userId], 'jobGet');
  if (!r.rows.length) return null;
  const j = r.rows[0];
  return {
    id: j.id, userId: j.user_id, kind: j.kind, label: j.label, status: j.status,
    createdAt: j.created_at, startedAt: j.started_at, endedAt: j.ended_at,
    result: j.result, error: j.error,
  };
}

export async function jobList(userId) {
  const r = await q('select * from jobs where user_id=$1 order by created_at desc limit 50', [userId], 'jobList');
  return r.rows.map((j) => ({
    id: j.id, userId: j.user_id, kind: j.kind, label: j.label, status: j.status,
    createdAt: j.created_at, startedAt: j.started_at, endedAt: j.ended_at,
    result: j.result, error: j.error,
  }));
}

export async function jobStats() {
  const r = await q(`select count(*) filter (where status='running')::int running, count(*) filter (where status='queued')::int queued from jobs`, [], 'jobStats');
  return { running: r.rows[0].running, queued: r.rows[0].queued, maxConcurrent: Number(process.env.METALOID_JOB_CONCURRENCY || 4), tracked: r.rows[0].running + r.rows[0].queued };
}

export async function jobDeleteUser(userId) {
  await q('delete from jobs where user_id=$1', [userId], 'jobDeleteUser');
  return true;
}

// ---------- rate counters (atomic, shared across instances) ----------

export async function rateCheck(key, max, windowMs) {
  const now = Date.now();
  const r = await q(
    `insert into rate_counters (key, window_start, count) values ($1, to_timestamp($2 / 1000.0), 1)
     on conflict (key) do update set count = rate_counters.count + 1, window_start = case when rate_counters.window_start < to_timestamp(($2 - $3) / 1000.0) then to_timestamp($2 / 1000.0) else rate_counters.window_start end
     returning count, window_start`,
    [key, now, windowMs], 'rateCheck'
  );
  const row = r.rows[0];
  const windowStart = new Date(row.window_start).getTime();
  const fresh = now - windowStart < windowMs;
  const count = fresh ? row.count : 1;
  if (!fresh) {
    await q('update rate_counters set count=1, window_start=to_timestamp($2 / 1000.0) where key=$1', [key, now], 'rateReset');
  }
  if (Math.random() < 0.01) {
    q(`delete from rate_counters where window_start < now() - interval '2 hours'`, [], 'rateGc').catch(() => {});
  }
  return { ok: fresh ? count <= max : true, count };
}

/** Crash recovery at boot: stale RUNNING → QUEUED with a checkpoint note. */
export async function msnRecover() {
  const r = await q(`update missions set status='QUEUED', updated_at=now(),
    data = jsonb_set(data, '{timeline}', coalesce(data->'timeline','[]'::jsonb) || jsonb_build_object('at', now()::text, 'event', 'Recovered', 'detail', 'Gateway restarted; mission re-queued from checkpoint.'))
    where status='RUNNING' returning id`, [], 'msnRecover');
  return r.rows.length;
}
