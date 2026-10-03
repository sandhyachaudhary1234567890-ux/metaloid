// RuntimeAdapters — the future execution boundary for non-JS skills.
// SkillRuntime asks HERE, never branches on file extensions itself.
// This phase: JS_SANDBOX live; PYTHON_SANDBOX / CONTAINER / REMOTE_SANDBOX
// are declared-but-unavailable (explicit, never faked). UI + test mode
// surface availability so users see capability truthfully.

import { runScript } from './skillSandbox.js';

export const ADAPTERS = {
  JS_SANDBOX: { kind: 'JS_SANDBOX', available: true, runs: ['.js'], note: 'node:vm, no require/process/fs/network, 5s timeout' },
  PYTHON_SANDBOX: { kind: 'PYTHON_SANDBOX', available: false, runs: ['.py'], note: 'Not enabled in this environment — needs an isolated interpreter jail.' },
  CONTAINER: { kind: 'CONTAINER', available: false, runs: ['*'], note: 'Not enabled — needs a container runtime with seccomp + no network.' },
  REMOTE_SANDBOX: { kind: 'REMOTE_SANDBOX', available: false, runs: ['*'], note: 'Not enabled — needs a Bound provider sandbox endpoint.' },
};

export function adapterFor(path) {
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.js')) return ADAPTERS.JS_SANDBOX;
  if (lower.endsWith('.py')) return ADAPTERS.PYTHON_SANDBOX;
  if (lower.endsWith('.sh') || lower.endsWith('.ps1') || lower.endsWith('.bat')) return ADAPTERS.CONTAINER;
  return ADAPTERS.CONTAINER; // unknown executables need full isolation
}

export function adapterStatus() {
  return Object.values(ADAPTERS).map((a) => ({ kind: a.kind, available: a.available, runs: a.runs, note: a.note }));
}

/** Execute the skill's entry script through its adapter (or refuse honestly). */
export function runEntry(entryPath, code, { input = {} } = {}) {
  const adapter = adapterFor(entryPath);
  if (!adapter.available) {
    return { ok: false, error: `${adapter.kind} is not enabled in this environment.`, adapter: adapter.kind, note: adapter.note };
  }
  return { ...runScript(code, { input, entry: entryPath }), adapter: adapter.kind };
}
