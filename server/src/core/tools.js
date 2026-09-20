// Tool fabric: registry → discovery → selection → execution → result.
// Tools declare: name/purpose/inputs/outputs/permissions/risk/cost/latency/
// side-effects/verification. Execution is permission-gated, timed out,
// validated, audited. No arbitrary code, no shell — handlers only.

import { emit } from './events.js';
import { authorize } from './permissions.js';

const registry = new Map();

export function defineTool(def) {
  if (!def?.name || typeof def.handler !== 'function') throw new Error('Tool needs name + handler');
  registry.set(def.name, {
    risk: 'read',
    timeoutMs: 15000,
    verify: 'none', // none | schema | crosscheck
    ...def,
  });
}

export function listTools() {
  return [...registry.values()].map((t) => ({
    name: t.name, purpose: t.purpose, inputs: t.inputs || {},
    outputs: t.outputs || {}, risk: t.risk, sideEffects: t.sideEffects || 'none',
    verification: t.verify,
  }));
}

export function discoverTools(query = '') {
  const q = query.toLowerCase();
  const all = [...registry.values()];
  if (!q) return all.map((t) => t.name);
  return all
    .filter((t) => `${t.name} ${t.purpose} ${(t.tags || []).join(' ')}`.toLowerCase().includes(q))
    .map((t) => t.name);
}

function validateInputs(tool, args) {
  const schema = tool.inputs || {};
  const errors = [];
  for (const [k, spec] of Object.entries(schema)) {
    const v = args?.[k];
    if (spec.required && (v === undefined || v === null || v === '')) errors.push(`missing:${k}`);
    if (v !== undefined && spec.type && typeof v !== spec.type) errors.push(`type:${k}`);
    if (typeof v === 'string' && spec.max && v.length > spec.max) errors.push(`too_long:${k}`);
    if (spec.pattern && typeof v === 'string' && !(new RegExp(spec.pattern).test(v))) errors.push(`pattern:${k}`);
  }
  return errors;
}

/** Execute with permission gate → timeout → validation → audit. */
export async function executeTool(name, args = {}, grants = {}) {
  const tool = registry.get(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  const gate = authorize(tool, args, grants);
  if (!gate.allowed) {
    emit('tool.denied', { tool: name, reason: gate.error });
    return { ok: false, error: gate.error, approvalId: gate.approvalId };
  }
  const bad = validateInputs(tool, args);
  if (bad.length) return { ok: false, error: `Invalid inputs: ${bad.join(',')}` };
  emit('tool.started', { tool: name });
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      tool.handler(args),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${tool.timeoutMs}ms`)), tool.timeoutMs)),
    ]);
    const ms = Date.now() - t0;
    emit('tool.completed', { tool: name, ms });
    return { ok: true, result, ms, verification: tool.verify };
  } catch (e) {
    emit('tool.failed', { tool: name, error: String(e.message || e) });
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }
}
