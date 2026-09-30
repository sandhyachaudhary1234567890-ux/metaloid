// Entitlements + usage budgets — central capability policy.
// Plans: free | plus | pro | team | enterprise. The AgentRuntime asks HERE
// before restricted capabilities; no product assumptions hardcoded elsewhere.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'usage.json');

export const PLANS = {
  free: {
    label: 'Free',
    chatPerDay: 100, missionsPerDay: 10, osintPerDay: 10,
    backgroundMissions: 1, maxMissionSteps: 25, maxMissionMs: 120000,
    voiceMinutesPerDay: 30, storageMB: 100,
    models: ['auto', 'fast'], cloudModels: false,
    capabilities: ['chat', 'voice', 'vision', 'osint', 'missions', 'memory', 'imagine-client'],
  },
  plus: {
    label: 'Plus',
    chatPerDay: 1000, missionsPerDay: 100, osintPerDay: 100,
    backgroundMissions: 3, maxMissionSteps: 60, maxMissionMs: 600000,
    voiceMinutesPerDay: 300, storageMB: 2000,
    models: ['auto', 'fast', 'smart', 'coding', 'voice'], cloudModels: true,
    capabilities: ['chat', 'voice', 'vision', 'osint', 'missions', 'memory', 'imagine-client', 'background', 'priority-routing'],
  },
  pro: {
    label: 'Pro',
    chatPerDay: 5000, missionsPerDay: 500, osintPerDay: 500,
    backgroundMissions: 10, maxMissionSteps: 150, maxMissionMs: 1800000,
    voiceMinutesPerDay: 1440, storageMB: 20000,
    models: ['auto', 'fast', 'smart', 'coding', 'voice', 'vision'], cloudModels: true,
    capabilities: ['chat', 'voice', 'vision', 'osint', 'missions', 'memory', 'imagine-client', 'background', 'priority-routing', 'workspaces-unlimited', 'devices-unlimited'],
  },
  team: {
    label: 'Team', // shares NOTHING personal: each member keeps isolated context;
    // team = separate shared-workspace scope (future), billed together.
    chatPerDay: 20000, missionsPerDay: 2000, osintPerDay: 2000,
    backgroundMissions: 25, maxMissionSteps: 200, maxMissionMs: 3600000,
    voiceMinutesPerDay: 5000, storageMB: 100000,
    models: ['auto', 'fast', 'smart', 'coding', 'voice', 'vision'], cloudModels: true,
    capabilities: ['chat', 'voice', 'vision', 'osint', 'missions', 'memory', 'imagine-client', 'background', 'priority-routing', 'workspaces-unlimited', 'devices-unlimited', 'shared-workspaces'],
  },
  enterprise: {
    label: 'Enterprise',
    chatPerDay: Infinity, missionsPerDay: Infinity, osintPerDay: Infinity,
    backgroundMissions: Infinity, maxMissionSteps: 500, maxMissionMs: 7200000,
    voiceMinutesPerDay: Infinity, storageMB: Infinity,
    models: ['auto', 'fast', 'smart', 'coding', 'voice', 'vision'], cloudModels: true,
    capabilities: ['*'],
  },
};

function load() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { /* start empty */ }
  return { plans: {}, usage: {} };
}
let store = load();
const persist = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store).slice(0, 5_000_000));
  } catch { /* ignore */ }
};

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export function getPlan(userId) {
  const p = store.plans[userId];
  return PLANS[p] ? p : 'free';
}

export function setPlan(userId, plan) {
  if (!PLANS[plan]) return null;
  store.plans[userId] = plan;
  persist();
  return plan;
}

export function planCaps(userId) {
  return PLANS[getPlan(userId)];
}

/** Runtime gate: can this user use this capability right now? */
export function can(userId, capability) {
  const caps = planCaps(userId).capabilities;
  return caps.includes('*') || caps.includes(capability);
}

function bucket(userId, kind) {
  const u = (store.usage[userId] = store.usage[userId] || {});
  const b = (u[kind] = u[kind] || { day: dayKey(), n: 0, month: monthKey(), m: 0 });
  if (b.day !== dayKey()) { b.day = dayKey(); b.n = 0; }
  if (b.month !== monthKey()) { b.month = monthKey(); b.m = 0; }
  return b;
}

/**
 * Budget gate for metered actions ('chat' | 'missions' | 'osint' | 'voice-min').
 * Returns {ok:true} or {ok:false, error} with a user-facing message.
 * When limits hit: pause/defer/ask per policy — never silently spend.
 */
export function checkBudget(userId, kind, amount = 1) {
  const caps = planCaps(userId);
  const limit = { chat: caps.chatPerDay, missions: caps.missionsPerDay, osint: caps.osintPerDay, 'voice-min': caps.voiceMinutesPerDay }[kind];
  if (limit === undefined) return { ok: true };
  if (!isFinite(limit)) return { ok: true };
  const b = bucket(userId, kind);
  if (b.n + amount > limit) {
    return { ok: false, error: `Daily ${kind} budget reached on the ${caps.label} plan. It resets tomorrow — or upgrade for more.` };
  }
  return { ok: true, remaining: limit - b.n - amount };
}

export function recordUsage(userId, kind, amount = 1) {
  const b = bucket(userId, kind);
  b.n += amount;
  b.m += amount;
  persist();
  return { day: b.n, month: b.m };
}

export function usageSummary(userId) {
  const caps = planCaps(userId);
  const out = { plan: getPlan(userId), label: caps.label };
  for (const kind of ['chat', 'missions', 'osint', 'voice-min']) {
    const b = bucket(userId, kind);
    const limit = { chat: caps.chatPerDay, missions: caps.missionsPerDay, osint: caps.osintPerDay, 'voice-min': caps.voiceMinutesPerDay }[kind];
    out[kind] = { usedToday: b.n, usedMonth: b.m, limit: isFinite(limit) ? limit : 'unlimited' };
  }
  return out;
}

export function deleteUsage(userId) {
  delete store.usage[userId];
  delete store.plans[userId];
  persist();
}
