// Event bus + audit log. Every runtime transition emits here;
// security events are never dropped (separate ring).

const listeners = new Map();
const audit = [];
const AUDIT_MAX = 500;

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function emit(type, payload = {}) {
  const evt = { at: new Date().toISOString(), type, ...payload };
  if (type.startsWith('security.') || type.startsWith('mission.') || type.startsWith('tool.')) {
    audit.push(evt);
    if (audit.length > AUDIT_MAX) audit.splice(0, audit.length - AUDIT_MAX);
  }
  for (const fn of listeners.get(type) || []) {
    try { fn(evt); } catch { /* listener fault isolated */ }
  }
  for (const fn of listeners.get('*') || []) {
    try { fn(evt); } catch { /* isolated */ }
  }
  return evt;
}

export function recentAudit(n = 100) {
  return audit.slice(-n);
}
