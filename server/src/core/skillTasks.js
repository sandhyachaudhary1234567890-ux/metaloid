// Skill↔TaskEngine integration CONTRACT.
// No scheduler daemon exists in this gateway yet — so this module defines
// the registration + execution contract a future TaskEngine (or external
// cron) calls. Schedules registered here are explicit user intent
// ("every Friday…"), stored per-user, and executed ONLY via runScheduled
// (which re-checks skill status, deps, budgets at fire time).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'skill-schedules.json');

function load() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { /* start empty */ }
  return { schedules: [] };
}
let store = load();
const persist = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 1).slice(0, 1_000_000));
  } catch { /* ignore */ }
};

let seq = 0;

/**
 * Register: "run skill X on cadence Y with input Z".
 * cadence is a HUMAN label for now ('fridays', 'daily', 'hourly', …) —
 * a real scheduler parses it later. Nothing runs on register.
 */
export function registerSchedule(userId, { skillId, cadence, input = {}, report = 'notify' }) {
  if (!userId || !skillId || !cadence) return { ok: false, error: 'skillId + cadence required.' };
  const s = {
    id: `sch-${Date.now().toString(36)}-${(++seq).toString(36)}`,
    userId, skillId, cadence: String(cadence).slice(0, 120),
    input: typeof input === 'object' && input ? input : {},
    report: ['notify', 'quiet', 'mission'].includes(report) ? report : 'notify',
    enabled: true, createdAt: new Date().toISOString(), lastRunAt: null, runs: 0,
  };
  store.schedules.push(s);
  persist();
  emit('skill.scheduled', { user: userId, skill: skillId, cadence: s.cadence });
  return { ok: true, schedule: s };
}

export function listSchedules(userId) {
  return store.schedules.filter((s) => s.userId === userId);
}

export function removeSchedule(userId, id) {
  const i = store.schedules.findIndex((s) => s.id === id && s.userId === userId);
  if (i < 0) return false;
  store.schedules.splice(i, 1);
  persist();
  return true;
}

/**
 * Fire a schedule NOW (called by the future daemon or manual "run now").
 * Re-validates everything at fire time: skill exists+enabled, deps,
 * user budget. Returns the skill result (skill → execution → verification
 * happens inside invokeSkill + caller verification).
 */
export async function runScheduled({ invokeSkill, checkBudget }, userId, id) {
  const s = store.schedules.find((x) => x.id === id && x.userId === userId && x.enabled);
  if (!s) return { ok: false, error: 'Unknown or disabled schedule.' };
  const budget = checkBudget ? checkBudget(userId, 'missions') : { ok: true };
  if (!budget.ok) return { ok: false, error: budget.error };
  const r = invokeSkill(userId, s.id ? s.skillId : s.skillId, { input: s.input, reason: `schedule:${s.id}` });
  s.lastRunAt = new Date().toISOString();
  s.runs += 1;
  persist();
  emit('skill.schedule_fired', { user: userId, schedule: id, ok: !!r.ok });
  return r;
}

export function deleteUserSchedules(userId) {
  store.schedules = store.schedules.filter((s) => s.userId !== userId);
  persist();
}
