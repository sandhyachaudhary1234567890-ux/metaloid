// Universal SkillRegistry — persistent, user-scoped skill packages.
// Code-defined system skills (osint, research, …) stay in core/skills.js;
// EVERYTHING user-added lives here with full §9 metadata, ownership scope
// (global/user/workspace/project), version history, and audit trail.
// Private skills never leak across users: all reads filter by visibility.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'skills.json');

export const SKILL_TYPES = [
  'knowledge', 'workflow', 'tool', 'agent', 'automation',
  'creative', 'coding', 'research', 'document', 'vision',
];
export const SKILL_SCOPES = ['global', 'user', 'workspace', 'project'];
export const SKILL_SOURCES = ['system', 'created', 'imported', 'repository', 'marketplace'];

function load() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { /* start empty */ }
  return { skills: [] };
}
let store = load();
const persist = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 1).slice(0, 8_000_000));
  } catch { /* ignore */ }
};

let seq = 0;
const sid = () => `skl-${Date.now().toString(36)}-${(++seq).toString(36)}`;

function needUser(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');
}

async function supa() {
  const m = await import('./supadb.js');
  return m.dbMode() ? m : null;
}

/** Load the live mutable skill (either backend). Mutations must sSave(). */
async function sGet(userId, id, ctx = {}) {
  const db = await supa();
  if (db) return db.skillGet(userId, id, ctx);
  return getSkillForSync(userId, id, ctx);
}

async function sSave(s) {
  const db = await supa();
  if (db) {
    await db.skillSave(s);
    return;
  }
  persist();
}

async function sInsert(s) {
  const db = await supa();
  if (db) {
    await db.skillInsert(s);
    return;
  }
  store.skills.push(s);
  persist();
}

function getSkillForSync(userId, id, ctx = {}) {
  needUser(userId);
  const s = store.skills.find((x) => x.id === id && x.status !== 'deleted');
  if (!s) return null;
  if (s.scope === 'global') return s;
  if (s.userId !== userId) return null;
  if (s.scope === 'workspace' && ctx.workspaceId && s.workspaceId !== ctx.workspaceId) return null;
  if (s.scope === 'project' && ctx.projectId && s.projectId !== ctx.projectId) return null;
  return s;
}

/** Visibility: system+global → everyone; user → owner; workspace/project → owner + matching context. */
export async function visibleSkills(userId, { workspaceId = null, projectId = null } = {}) {
  needUser(userId);
  const db = await supa();
  if (db) return db.skillList(userId, { workspaceId, projectId });
  return store.skills.filter((s) => {
    if (s.status === 'deleted') return false;
    if (s.scope === 'global') return true;
    if (s.userId !== userId) return false;
    if (s.scope === 'user') return true;
    if (s.scope === 'workspace') return !workspaceId || s.workspaceId === workspaceId;
    if (s.scope === 'project') return !projectId || s.projectId === projectId;
    return false;
  });
}

export async function getSkillFor(userId, id, ctx = {}) {
  needUser(userId);
  return sGet(userId, id, ctx);
}

/** L1 — metadata only (progressive disclosure: never dump instructions). */
export function skillCard(s) {
  const { files, versions, audit, instructions, references, scripts, ...rest } = s;
  void files; void versions; void audit; void instructions; void references; void scripts;
  return rest;
}

export async function listSkillCards(userId, ctx = {}) {
  return (await visibleSkills(userId, ctx)).map(skillCard);
}

function audit(s, event, detail = '') {
  s.audit.push({ at: new Date().toISOString(), event, detail: String(detail).slice(0, 300) });
  if (s.audit.length > 100) s.audit.length = 100;
}

/**
 * Install a VALIDATED package (validate with skillPackage.js first).
 * pkg: { manifest, files, instructions, references, scripts }.
 */
export async function installSkill(userId, pkg, { scope = 'user', workspaceId = null, projectId = null, source = 'imported' } = {}) {
  needUser(userId);
  const m = pkg.manifest;
  if (!SKILL_SCOPES.includes(scope)) return { ok: false, error: 'Bad scope.' };
  if (scope === 'global') return { ok: false, error: 'Only admins publish global skills.' };
  const now = new Date().toISOString();
  const s = {
    id: sid(),
    name: m.name, description: m.description, version: m.version || '1.0.0',
    author: m.author || 'you', license: m.license || 'private',
    userId, scope, workspaceId: scope === 'workspace' ? workspaceId : null,
    projectId: scope === 'project' ? projectId : null,
    source, status: 'enabled',
    types: m.types || ['knowledge'],
    capabilities: m.capabilities || [],
    permissions: m.permissions || { filesystem: 'none', network: 'none' },
    dependencies: m.dependencies || { tools: [], plugins: [], providers: [], packages: [] },
    tools: m.tools || [],
    triggers: m.triggers || [],
    verification: m.verification || { policy: 'self-check', checks: [] },
    command: m.command || null, // explicit /command (without slash)
    instructions: pkg.instructions || '',
    references: pkg.references || {}, // name -> text
    scripts: pkg.scripts || {}, // path -> code
    examples: m.examples || [],
    security: pkg.security || { risk: 'low', findings: [] },
    files: pkg.files || {}, // raw package files (capped)
    versions: [{ version: m.version || '1.0.0', at: now, note: 'installed', manifest: { ...m }, instructions: pkg.instructions || '', scripts: pkg.scripts || {} }],
    createdAt: now, updatedAt: now, lastUsedAt: null, useCount: 0,
    audit: [],
  };
  audit(s, 'installed', `${source} scope=${scope}`);
  await sInsert(s);
  emit('skill.installed', { id: s.id, user: userId, scope });
  return { ok: true, skill: skillCard(s) };
}

export async function updateSkill(userId, id, pkg, note = '') {
  const s = await getSkillFor(userId, id);
  if (!s) return { ok: false, error: 'Unknown skill.' };
  if (s.source === 'system') return { ok: false, error: 'System skills are not editable.' };
  // validate → scan → preserve previous version (rollback safety).
  // Snapshots keep the manifest so update diffs stay inspectable.
  const snapManifest = (s) => ({
    name: s.name, description: s.description, version: s.version,
    types: s.types, capabilities: s.capabilities, permissions: s.permissions,
    dependencies: s.dependencies, tools: s.tools, triggers: s.triggers,
    verification: s.verification, command: s.command, license: s.license,
  });
  s.versions.push({ version: s.version, at: new Date().toISOString(), note: 'pre-update snapshot', manifest: snapManifest(s), instructions: s.instructions, scripts: s.scripts });
  const m = pkg.manifest;
  s.name = m.name; s.description = m.description;
  s.version = m.version && m.version !== s.version ? m.version : bumpPatch(s.version);
    s.types = m.types || s.types;
    s.license = m.license || s.license;
  s.capabilities = m.capabilities || [];
  s.permissions = m.permissions || s.permissions;
  s.dependencies = m.dependencies || s.dependencies;
  s.tools = m.tools || [];
  s.triggers = m.triggers || [];
  s.verification = m.verification || s.verification;
  s.command = m.command || s.command;
  s.instructions = pkg.instructions || s.instructions;
  s.references = pkg.references || {};
  s.scripts = pkg.scripts || {};
  s.files = pkg.files || {};
  s.security = pkg.security || s.security;
  s.examples = m.examples || [];
  s.updatedAt = new Date().toISOString();
  s.versions.push({ version: s.version, at: s.updatedAt, note: note || 'updated', manifest: { ...m }, instructions: s.instructions, scripts: s.scripts });
  if (s.versions.length > 20) s.versions.splice(0, s.versions.length - 20);
  audit(s, 'updated', `v${s.version} ${note}`.slice(0, 120));
  await sSave(s);
  emit('skill.updated', { id, user: userId });
  return { ok: true, skill: skillCard(s) };
}

function bumpPatch(v) {
  const m = String(v || '1.0.0').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return '1.0.1';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** Rollback to a preserved version snapshot. */
export async function rollbackSkill(userId, id, version) {
  const s = await getSkillFor(userId, id);
  if (!s) return { ok: false, error: 'Unknown skill.' };
  const snap = [...s.versions].reverse().find((v) => v.version === version && v.instructions !== undefined);
  if (!snap) return { ok: false, error: 'Version not found.' };
  s.versions.push({ version: s.version, at: new Date().toISOString(), note: 'pre-rollback snapshot', instructions: s.instructions, scripts: s.scripts });
  s.version = version + '-restored';
  s.instructions = snap.instructions;
  s.scripts = snap.scripts || {};
  s.updatedAt = new Date().toISOString();
  audit(s, 'rollback', `to v${version}`);
  await sSave(s);
  emit('skill.rollback', { id, user: userId, version });
  return { ok: true, skill: skillCard(s) };
}

export async function setSkillStatus(userId, id, enabled) {
  const s = await getSkillFor(userId, id);
  if (!s) return { ok: false, error: 'Unknown skill.' };
  if (s.source === 'system' && !enabled) return { ok: false, error: 'System skills stay enabled.' };
  s.status = enabled ? 'enabled' : 'disabled';
  s.updatedAt = new Date().toISOString();
  audit(s, enabled ? 'enabled' : 'disabled', '');
  await sSave(s);
  return { ok: true, skill: skillCard(s) };
}

export async function deleteSkill(userId, id) {
  const s = await getSkillFor(userId, id);
  if (!s) return false;
  if (s.source === 'system') return false;
  s.status = 'deleted'; // tombstone keeps audit + versions recoverable
  audit(s, 'deleted', '');
  await sSave(s);
  emit('skill.deleted', { id, user: userId });
  return true;
}

/** Duplicate into the caller's own scope (share-by-copy, explicit). */
export async function duplicateSkill(userId, id) {
  const s = await getSkillFor(userId, id);
  if (!s || s.source === 'system') return { ok: false, error: 'Cannot duplicate that skill.' };
  return installSkill(userId, {
    manifest: {
      name: s.name + ' (copy)', description: s.description, version: '1.0.0',
      types: s.types, capabilities: s.capabilities, permissions: s.permissions,
      dependencies: s.dependencies, tools: s.tools, triggers: s.triggers,
      verification: s.verification, command: null, author: s.author, examples: s.examples,
    },
    instructions: s.instructions, references: s.references, scripts: s.scripts, files: s.files,
    security: s.security,
  }, { scope: 'user', source: 'imported' });
}

/** L2 — instructions + reference NAMES (content per-file on demand). */
export async function inspectSkill(userId, id) {
  const s = await getSkillFor(userId, id);
  if (!s) return null;
  audit(s, 'inspected', '');
  await sSave(s);
  return {
    ...skillCard(s),
    instructions: s.instructions,
    referenceNames: Object.keys(s.references || {}),
    scriptNames: Object.keys(s.scripts || {}),
    versions: s.versions.map((v) => ({ version: v.version, at: v.at, note: v.note })),
    audit: s.audit.slice(-20),
  };
}

/** L3 — single reference/script file content (audited). */
export async function readSkillFile(userId, id, kind, name) {
  const s = await getSkillFor(userId, id);
  if (!s) return null;
  const bag = kind === 'reference' ? s.references : s.scripts;
  if (!bag || typeof bag[name] !== 'string') return null;
  audit(s, 'file_read', `${kind}:${name}`);
  await sSave(s);
  return { name, content: bag[name].slice(0, 60000) };
}

export async function markSkillUsed(userId, id, detail = '') {
  const s = await getSkillFor(userId, id);
  if (!s) return;
  s.lastUsedAt = new Date().toISOString();
  s.useCount += 1;
  audit(s, 'invoked', detail);
  await sSave(s);
}

export async function skillAudit(userId, id) {
  const s = await getSkillFor(userId, id);
  if (!s) return null;
  return s.audit;
}

/** Inspectable update diff between two preserved versions (or version→current). */
export async function diffVersions(userId, id, from, to = null) {
  const s = await getSkillFor(userId, id);
  if (!s) return null;
  const byV = (v) => [...s.versions].reverse().find((x) => x.version === v);
  const a = byV(from);
  const b = to ? byV(to) : null;
  if (!a) return { ok: false, error: 'Base version not found.' };
  const bMan = b?.manifest || null;
  const cur = {
    manifest: {
      name: s.name, description: s.description, version: s.version,
      types: s.types, capabilities: s.capabilities, permissions: s.permissions,
      dependencies: s.dependencies, tools: s.tools, triggers: s.triggers,
      verification: s.verification, command: s.command, license: s.license,
    },
    instructions: s.instructions, scripts: s.scripts,
  };
  const tgt = b ? { manifest: bMan, instructions: b.instructions, scripts: b.scripts } : cur;
  if (!a.manifest || !tgt.manifest) {
    return { ok: true, from, to: to || `${s.version} (current)`, legacy: true, note: 'Manifest snapshot unavailable for old versions — file/instruction diff only.', diff: diffBlobs(a, tgt) };
  }
  return { ok: true, from, to: to || `${s.version} (current)`, diff: { ...diffManifests(a.manifest, tgt.manifest), ...diffBlobs(a, tgt) } };
}

function diffBlobs(a, b) {
  const aFiles = new Set([...Object.keys(a.scripts || {}), '__instructions__']);
  const bFiles = new Set([...Object.keys(b.scripts || {}), '__instructions__']);
  return {
    instructionsChanged: (a.instructions || '') !== (b.instructions || ''),
    filesAdded: [...bFiles].filter((f) => !aFiles.has(f)),
    filesRemoved: [...aFiles].filter((f) => !bFiles.has(f)),
  };
}

function diffManifests(a, b) {
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const out = {};
  for (const k of ['name', 'description', 'command', 'license']) {
    if (!eq(a[k], b[k])) out[k] = { from: a[k] ?? null, to: b[k] ?? null };
  }
  for (const k of ['types', 'capabilities', 'tools', 'triggers']) {
    const af = new Set(a[k] || []);
    const bf = new Set(b[k] || []);
    const added = [...bf].filter((x) => !af.has(x));
    const removed = [...af].filter((x) => !bf.has(x));
    if (added.length || removed.length) out[k] = { added, removed };
  }
  // permissions: escalations called out explicitly (none → read-only tightening is safe)
  const perms = {};
  const keys = new Set([...Object.keys(a.permissions || {}), ...Object.keys(b.permissions || {})]);
  for (const k of keys) {
    if (!eq(a.permissions?.[k], b.permissions?.[k])) perms[k] = { from: a.permissions?.[k] ?? null, to: b.permissions?.[k] ?? null };
  }
  if (Object.keys(perms).length) {
    const risky = (v) => v && v !== 'none' && v !== 'read-only';
    out.permissions = {
      ...perms,
      escalated: Object.entries(perms).filter(([, v]) => risky(v.to) && !risky(v.from)).map(([k]) => k),
    };
  }
  const deps = {};
  for (const k of ['tools', 'plugins', 'providers', 'packages']) {
    const af = new Set(a.dependencies?.[k] || []);
    const bf = new Set(b.dependencies?.[k] || []);
    const added = [...bf].filter((x) => !af.has(x));
    const removed = [...af].filter((x) => !bf.has(x));
    if (added.length || removed.length) deps[k] = { added, removed };
  }
  if (Object.keys(deps).length) out.dependencies = deps;
  return out;
}

/** Register a code-defined system skill as a visible GLOBAL package. */
export async function registerSystemSkill(def) {
  const db = await supa();
  if (db) {
    const existing = await db.skillGet('system', `sys-${def.id}`, {});
    if (existing) return skillCard(existing);
  } else {
    const found = store.skills.find((x) => x.id === `sys-${def.id}` && x.status !== 'deleted');
    if (found) return skillCard(found);
  }
  const now = new Date().toISOString();
  const s = {
    id: `sys-${def.id}`, name: def.name, description: def.description || '',
    version: def.version || '1.0.0', author: 'Metaloid',
    userId: 'system', scope: 'global', workspaceId: null, projectId: null,
    source: 'system', status: 'enabled',
    types: ['agent'], capabilities: def.capabilities || [], permissions: { note: 'platform-internal' },
    dependencies: { tools: def.tools || [], plugins: [], providers: [], packages: [] },
    tools: def.tools || [], triggers: def.keywords || [],
    verification: { policy: def.verificationPolicy || 'self-check', checks: [] },
    command: null, instructions: '', references: {}, scripts: {},
    examples: [], security: { risk: 'low', findings: [] }, files: {},
    versions: [{ version: def.version || '1.0.0', at: now, note: 'system' }],
    createdAt: now, updatedAt: now, lastUsedAt: null, useCount: 0, audit: [],
  };
  await sInsert(s);
  return skillCard(s);
}

export async function deleteUserSkills(userId) {
  const db = await supa();
  if (db) return db.skillDeleteUser(userId);
  const before = store.skills.length;
  store.skills = store.skills.filter((s) => s.userId !== userId);
  persist();
  return before - store.skills.length;
}
