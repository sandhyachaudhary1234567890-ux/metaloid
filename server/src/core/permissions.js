// Permission engine — deterministic, never delegated to the model.
// Action classes: read < reversible < external < irreversible.
// Irreversible + external side effects need explicit approval (queued,
// granted via API). Model may propose; only this module disposes.

import { emit } from './events.js';

export const RISK = { read: 0, reversible: 1, external: 2, irreversible: 3 };

const approvals = new Map(); // id -> {action, detail, status, at}
let seq = 0;

export function classify(tool) {
  return RISK[tool.risk] ?? 0;
}

/**
 * Returns {allowed:true} | {allowed:false, approvalId} | {allowed:false, error}
 * Pure function of (tool, args, grants). Model output never reaches here
 * except as validated args against the tool schema.
 */
export function authorize(tool, args, grants = {}) {
  const risk = classify(tool);
  if (risk <= RISK.reversible) return { allowed: true };
  if (risk === RISK.external && grants.external) return { allowed: true };
  if (risk === RISK.irreversible && grants.irreversible) return { allowed: true };
  const id = `apr-${Date.now().toString(36)}-${(++seq).toString(36)}`;
  approvals.set(id, {
    id, tool: tool.name, args: sanitizeArgs(args),
    risk: tool.risk, status: 'pending', at: new Date().toISOString(),
  });
  emit('security.approval_requested', { id, tool: tool.name, risk: tool.risk });
  return { allowed: false, approvalId: id, error: `Requires explicit approval (${tool.risk}).` };
}

function sanitizeArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    out[k] = typeof v === 'string' ? v.slice(0, 300) : v;
  }
  return out;
}

export function grantApproval(id, approved, by = 'user') {
  const a = approvals.get(id);
  if (!a || a.status !== 'pending') return null;
  a.status = approved ? 'granted' : 'denied';
  a.by = by;
  emit('security.approval_decided', { id, tool: a.tool, status: a.status, by });
  return a;
}

export function pendingApprovals() {
  return [...approvals.values()].filter((a) => a.status === 'pending');
}

export function checkApproval(id) {
  return approvals.get(id) || null;
}
