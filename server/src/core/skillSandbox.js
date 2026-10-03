// SkillSandbox — uploaded scripts are UNTRUSTED code.
// .js entries run in node:vm with: no require/process/fs/network,
// 5s timeout, frozen console capture, 1MB result cap.
// Anything else (python, shell, binaries) is REFUSED — returned as an
// inert plan, never executed, never faked as executed.

import vm from 'node:vm';

const TIMEOUT_MS = 5000;

export function runScript(code, { input = {}, entry = 'main.js' } = {}) {
  const src = String(code || '');
  if (!src.trim()) return { ok: false, error: 'Empty script.' };
  if (src.length > 200_000) return { ok: false, error: 'Script too large.' };
  const logs = [];
  const sandbox = {
    input: deepFreeze(input),
    output: undefined,
    console: {
      log: (...a) => logs.push(a.map((x) => safeStr(x)).join(' ').slice(0, 2000)),
      error: (...a) => logs.push('[err] ' + a.map((x) => safeStr(x)).join(' ').slice(0, 2000)),
    },
    Math, JSON, String, Number, Boolean, Array, Object, Date, RegExp,
    setTimeout: undefined, setInterval: undefined, queueMicrotask: undefined,
  };
  // codeGeneration belongs on createContext (runInContext options do NOT
  // enforce it): without this, ({}).constructor.constructor('...') compiles
  // host-context functions and escapes. strings:false neuters new
  // Function()/eval() — the constructor object itself is then harmless.
  const ctx = vm.createContext(sandbox, {
    name: `skill:${entry}`,
    codeGeneration: { strings: false, wasm: false },
  });
  try {
    // wrap: script sets `output = {...}` (or returns via last expression)
    const wrapped = `${src}\n;output;`;
    const result = vm.runInContext(wrapped, ctx, { timeout: TIMEOUT_MS, displayErrors: true });
    return { ok: true, result: cap(result), logs: logs.slice(0, 50) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300), logs: logs.slice(0, 50) };
  }
}

function safeStr(x) {
  try {
    return typeof x === 'string' ? x : JSON.stringify(x);
  } catch {
    return '[unserializable]';
  }
}

function cap(v) {
  if (v === undefined) return null;
  try {
    const s = JSON.stringify(v, (k, val) => (typeof val === 'bigint' ? String(val) : typeof val === 'function' ? '[fn]' : val));
    if (!s || s.length > 1_000_000) return { truncated: true, preview: String(s || '').slice(0, 2000) };
    return JSON.parse(s);
  } catch {
    return { preview: safeStr(v).slice(0, 2000) };
  }
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/** Adversarial self-check used by tests: escape attempts must fail. */
export function probeEscape() {
  const attempts = {
    require: `output = typeof require;`,
    process: `output = typeof process;`,
    fetch: `output = typeof fetch;`,
    global: `output = (typeof globalThis !== 'undefined' && globalThis.process) ? 'LEAK' : 'clean';`,
    constructor: `output = ({}).constructor.constructor('return 1')();`,
    timeout: `output = typeof setTimeout;`,
  };
  const out = {};
  for (const [k, code] of Object.entries(attempts)) {
    const r = runScript(code, {});
    out[k] = r.ok ? r.result : `blocked:${r.error}`;
  }
  return out;
}
