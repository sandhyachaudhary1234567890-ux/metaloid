// Observability: missions, tasks, tool calls, models, latency, tokens,
// failures, retries, verification, memory ops, permissions, security.
// User UI stays clean; this feeds the debug surface (/api/debug/summary).

const counters = new Map();
const latencies = [];
const modelCalls = [];
const MAX = 300;

function bump(k, by = 1) {
  counters.set(k, (counters.get(k) || 0) + by);
}

export function track(type, data = {}) {
  bump(`evt.${type}`);
  if (type === 'tool.completed') bump('tools.ok');
  if (type === 'tool.failed') bump('tools.failed');
  if (type === 'tool.denied') bump('security.denials');
  if (type === 'security.approval_requested') bump('security.approvals');
  if (type === 'mission.completed') bump('missions.completed');
  if (type === 'mission.failed') bump('missions.failed');
  if (data.ms !== undefined) {
    latencies.push(data.ms);
    if (latencies.length > MAX) latencies.shift();
  }
}

export function trackModel({ provider, model, tier, ms, tokens, ok }) {
  modelCalls.push({ at: new Date().toISOString(), provider, model, tier, ms, tokens: tokens || null, ok });
  if (modelCalls.length > MAX) modelCalls.shift();
  bump('models.calls');
  if (!ok) bump('models.failed');
}

export function summary() {
  const lat = [...latencies].sort((a, b) => a - b);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : 0);
  return {
    counters: Object.fromEntries(counters),
    latencyMs: { p50: pct(50), p95: pct(95), n: lat.length },
    recentModels: modelCalls.slice(-20),
  };
}
