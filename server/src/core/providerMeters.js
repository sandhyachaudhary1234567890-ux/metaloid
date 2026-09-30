// Provider meters — per-user, per-provider usage from ADAPTER-REPORTED
// numbers only. Tokens + latency + request counts are real; cost is shown
// ONLY when a provider reports it (none of the chat providers do — the UI
// must label cost "not reported", never an invented estimate).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'provider-usage.json');

function load() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { /* start empty */ }
  return { usage: {} };
}
let store = load();
const persist = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store).slice(0, 2_000_000));
  } catch { /* ignore */ }
};

export function recordProviderUsage(userId, providerId, { promptTokens = 0, completionTokens = 0, ms = 0, ok = true, costUsd = null } = {}) {
  if (!userId || !providerId) return;
  const u = (store.usage[userId] = store.usage[userId] || {});
  const p = (u[providerId] = u[providerId] || {
    requests: 0, errors: 0, promptTokens: 0, completionTokens: 0,
    totalTokens: 0, msTotal: 0, costUsdReported: 0, costReported: false, lastAt: null,
  });
  p.requests += 1;
  if (!ok) p.errors += 1;
  p.promptTokens += promptTokens;
  p.completionTokens += completionTokens;
  p.totalTokens += promptTokens + completionTokens;
  p.msTotal += ms;
  if (typeof costUsd === 'number' && isFinite(costUsd)) {
    p.costUsdReported += costUsd;
    p.costReported = true;
  }
  p.lastAt = new Date().toISOString();
  persist();
}

export function providerUsageSummary(userId) {
  const u = store.usage[userId] || {};
  const out = {};
  for (const [pid, p] of Object.entries(u)) {
    out[pid] = {
      ...p,
      avgLatencyMs: p.requests ? Math.round(p.msTotal / p.requests) : 0,
      // explicit: estimates are labeled, provider-reported cost only when present
      cost: p.costReported ? { usd: p.costUsdReported, source: 'provider-reported' } : { usd: null, source: 'not-reported-by-provider' },
    };
  }
  return out;
}

export function deleteProviderUsage(userId) {
  delete store.usage[userId];
  persist();
}
