// Mission engine: persistent task graphs with deps, parallelism, retries,
// checkpoints, pause/resume/cancel, budgets. "Continue" resumes state.
// Statuses: QUEUED → RUNNING ⇄ PAUSED → COMPLETED → VERIFIED | FAILED | BLOCKED.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';
import { executeTool } from './tools.js';
import { skillBrief } from './skills.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'missions.json');

let store = { missions: [] };
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // crash recovery: RUNNING missions return to QUEUED with a checkpoint note
    for (const m of store.missions) {
      if (m.status === 'RUNNING') {
        m.status = 'QUEUED';
        m.timeline.push({ at: new Date().toISOString(), event: 'Recovered', detail: 'Gateway restarted; mission re-queued from checkpoint.' });
      }
    }
  }
} catch { /* start empty */ }

function persist() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 1).slice(0, 5_000_000));
  } catch { /* ignore */ }
}

let seq = 0;
const mid = () => `msn-${Date.now().toString(36)}-${(++seq).toString(36)}`;
const tid = () => `tsk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function createMission({ objective, constraints = [], priority = 'normal', tasks = [], skillIds = [] }) {
  // assign ids first so positional depIdx can resolve to real ids
  const withIds = tasks.map((t) => ({ id: tid(), ...t }));
  withIds.forEach((t, i) => {
    if (Array.isArray(t.depIdx)) {
      t.deps = t.depIdx.map((d) => withIds[d]?.id).filter(Boolean);
      delete t.depIdx;
    }
    if (!Array.isArray(t.deps)) t.deps = [];
    void i;
  });
  const m = {
    id: mid(),
    objective: String(objective).slice(0, 500),
    constraints: constraints.map((c) => String(c).slice(0, 200)),
    priority,
    status: 'QUEUED',
    skillIds,
    tasks: withIds.map((t) => ({
      id: t.id, name: t.name, skill: t.skill || null, tool: t.tool || null,
      args: t.args || {}, deps: t.deps || [], status: 'QUEUED',
      attempts: 0, result: null, error: null, evidence: [],
      startedAt: null, endedAt: null,
    })),
    outputs: {}, decisions: [], errors: [],
    checkpoints: [], timeline: [{ at: new Date().toISOString(), event: 'Created', detail: objective.slice(0, 120) }],
    budgets: { maxMs: 120000, maxSteps: 25 },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    _flags: { paused: false, cancelled: false },
  };
  store.missions.unshift(m);
  if (store.missions.length > 100) store.missions.length = 100;
  persist();
  emit('mission.created', { id: m.id, objective: m.objective.slice(0, 80) });
  return publicMission(m);
}

export function getMission(id) {
  return store.missions.find((m) => m.id === id) || null;
}

export function listMissions() {
  return store.missions.map(publicMission);
}

export function latestActive() {
  return store.missions.find((m) => ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED'].includes(m.status)) || null;
}

function publicMission(m) {
  const { _flags, ...rest } = m;
  return rest;
}

function log(m, event, detail = '') {
  m.timeline.push({ at: new Date().toISOString(), event, detail });
  m.updatedAt = new Date().toISOString();
}

function checkpoint(m, note) {
  m.checkpoints.push({ at: new Date().toISOString(), note, done: m.tasks.filter((t) => t.status === 'COMPLETED').length, total: m.tasks.length });
  persist();
}

function readyTasks(m) {
  const done = new Set(m.tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.id));
  return m.tasks.filter((t) => t.status === 'QUEUED' && t.deps.every((d) => done.has(d)));
}

async function runTask(m, t, grants) {
  t.status = 'RUNNING';
  t.startedAt = new Date().toISOString();
  t.attempts += 1;
  log(m, 'Task started', t.name);
  emit('mission.task_started', { mission: m.id, task: t.name });
  persist();

  if (!t.tool) {
    // planning/notes task with no tool — mark complete with its brief
    t.status = 'COMPLETED';
    t.result = { note: t.name, brief: t.skill ? skillBrief(t.skill) : null };
    t.endedAt = new Date().toISOString();
    persist();
    return;
  }
  const r = await executeTool(t.tool, t.args, grants);
  t.endedAt = new Date().toISOString();
  if (r.ok) {
    t.status = 'COMPLETED';
    t.result = r.result;
    t.evidence.push({ tool: t.tool, at: t.endedAt, ms: r.ms });
  } else if (r.approvalId) {
    t.status = 'BLOCKED';
    t.error = r.error;
    m.errors.push({ task: t.name, error: r.error, approvalId: r.approvalId });
    log(m, 'Task blocked', `${t.name}: awaiting approval ${r.approvalId}`);
  } else if (t.attempts < 2) {
    t.status = 'QUEUED'; // retry once, differently is the caller's job
    t.error = r.error;
    log(m, 'Task retrying', `${t.name}: ${r.error}`);
  } else {
    t.status = 'FAILED';
    t.error = r.error;
    m.errors.push({ task: t.name, error: r.error });
    log(m, 'Task failed', `${t.name}: ${r.error}`);
  }
  persist();
}

/** Run until done/paused/cancelled/blocked. Resumable via runMission(id). */
export async function runMission(id, grants = {}) {
  const m = getMission(id);
  if (!m) return null;
  if (!['QUEUED', 'PAUSED', 'BLOCKED'].includes(m.status)) return publicMission(m);
  m.status = 'RUNNING';
  m._flags.paused = false;
  m._flags.cancelled = false;
  log(m, m.timeline.length > 1 ? 'Resumed' : 'Running', `${m.tasks.length} tasks`);
  emit('mission.started', { id: m.id });
  persist();

  const t0 = Date.now();
  let steps = 0;
  while (true) {
    if (m._flags.cancelled) {
      m.status = 'PAUSED';
      log(m, 'Cancelled', 'checkpoint saved; resume with continue');
      break;
    }
    if (m._flags.paused) {
      m.status = 'PAUSED';
      log(m, 'Paused', 'checkpoint saved');
      break;
    }
    if (Date.now() - t0 > m.budgets.maxMs || steps >= m.budgets.maxSteps) {
      m.status = 'BLOCKED';
      log(m, 'Blocked', 'Budget exhausted — reduce scope or resume with higher budget');
      break;
    }
    const ready = readyTasks(m);
    if (!ready.length) {
      // nothing runnable but work remains → deadlock/unsatisfied deps, not RUNNING
      if (m.status === 'RUNNING' && m.tasks.some((t) => ['QUEUED', 'RUNNING', 'PAUSED'].includes(t.status))) {
        m.status = 'BLOCKED';
        log(m, 'Blocked', 'No runnable tasks — unsatisfied dependencies or deadlock. Inspect the graph.');
      }
      break;
    }
    steps += ready.length;
    await Promise.all(ready.slice(0, 3).map((t) => runTask(m, t, grants)));
    checkpoint(m, `level complete (${steps} steps)`);
    if (m.tasks.some((t) => t.status === 'BLOCKED')) {
      m.status = 'BLOCKED';
      break;
    }
  }

  const failed = m.tasks.filter((t) => t.status === 'FAILED');
  const pending = m.tasks.filter((t) => ['QUEUED', 'RUNNING', 'PAUSED'].includes(t.status));
  if (!pending.length && !failed.length && m.status === 'RUNNING') {
    m.status = 'COMPLETED';
    log(m, 'Completed', `${m.tasks.length} tasks, ${m.errors.length} errors noted`);
    emit('mission.completed', { id: m.id });
  } else if (failed.length && !pending.length && m.status === 'RUNNING') {
    m.status = 'FAILED';
    log(m, 'Failed', `${failed.length} tasks failed after retry — see errors`);
    emit('mission.failed', { id: m.id, failed: failed.length });
  }
  checkpoint(m, `terminal:${m.status}`);
  persist();
  return publicMission(m);
}

export function pauseMission(id) {
  const m = getMission(id);
  if (!m) return null;
  m._flags.paused = true;
  return publicMission(m);
}

export function cancelMission(id) {
  const m = getMission(id);
  if (!m) return null;
  m._flags.cancelled = true;
  return publicMission(m);
}

export function markVerified(id, note = '') {
  const m = getMission(id);
  if (!m || m.status !== 'COMPLETED') return null;
  m.status = 'VERIFIED';
  log(m, 'Verified', note || 'Outcome independently checked');
  persist();
  return publicMission(m);
}

/** Attach model synthesis + verification to a finished mission. */
export function attachReport(id, report, verification) {
  const m = getMission(id);
  if (!m) return null;
  m.outputs.report = report;
  m.decisions.push('Synthesis by model over verified task evidence');
  m.outputs.verification = verification || null;
  if (verification?.passed && m.status === 'COMPLETED') {
    m.status = 'VERIFIED';
    log(m, 'Verified', 'Report passed self-checks');
  }
  persist();
  return publicMission(m);
}
