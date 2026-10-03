// METALOID showcase — one command, whole product running.
//
//   npm run showcase
//
// Starts three processes and wires them together:
//   1. sandbox provider  (server/tests/fake-provider.mjs)  — streams real SSE
//      tokens locally, so the full loop works with no API key and no network
//   2. gateway           (server/src/index.js)             — /api, port 8787
//   3. app               (vite)                            — port 5173, proxies /api
//
// The gateway self-identifies as a SANDBOX provider in this mode (never a
// fake "ONLINE"): set OPENROUTER_API_KEY and run `npm run dev` + `npm run
// gateway` for live models.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDER_PORT = Number(process.env.SANDBOX_PROVIDER_PORT || 9911);
const GATEWAY_PORT = Number(process.env.PORT || 8787);

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  accent: (s) => `\x1b[38;5;45m${s}\x1b[0m`,
  violet: (s) => `\x1b[38;5;141m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const children = [];
function run(name, cmd, args, cwd, env = {}, color = C.dim) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const tag = color(`[${name}]`);
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += String(d);
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const l of lines) if (l.trim()) console.log(`${tag} ${l}`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && code !== 0 && code !== null) {
      console.log(`${tag} ${C.yellow(`exited (${code})`)}`);
    }
  });
  return child;
}

function shutdown(code = 0) {
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(code), 150);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('');
console.log(C.bold(C.accent('  METALOID')) + C.dim('  ·  showcase mode'));
console.log('');

run('sandbox', process.execPath, [
  path.join(ROOT, 'server', 'tests', 'fake-provider.mjs'),
  '--port', String(PROVIDER_PORT), '--scenario', 'ok',
], ROOT, {}, C.violet);

// give the provider a beat to bind before the gateway probes it
await new Promise((r) => setTimeout(r, 350));

run('gateway', process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], path.join(ROOT, 'server'), {
  PORT: String(GATEWAY_PORT),
  // loopback on purpose: only the app's own proxy reaches the gateway, so a
  // tunnel/preview never exposes an auth-less API that fronts provider keys
  BIND_HOST: '127.0.0.1',
  OPENROUTER_BASE: `http://127.0.0.1:${PROVIDER_PORT}/api/v1`,
  OPENROUTER_API_KEY: 'sandbox-key-not-a-real-credential',
  ALLOW_ORIGINS: process.env.ALLOW_ORIGINS || '*',
}, C.dim);

await new Promise((r) => setTimeout(r, 600));

run('app', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], ROOT, {}, C.accent);

setTimeout(() => {
  console.log('');
  console.log(`  ${C.bold('app')}      ${C.accent('http://localhost:5173')}`);
  console.log(`  ${C.bold('gateway')}  ${C.dim(`http://localhost:${GATEWAY_PORT}/api/health`)}`);
  console.log(`  ${C.bold('sandbox')}  ${C.violet(`http://127.0.0.1:${PROVIDER_PORT}`)} ${C.dim('(canned model, real SSE)')}`);
  console.log('');
  console.log(C.dim('  The sidebar shows SANDBOX, not ONLINE — that is the honest state.'));
  console.log(C.dim('  For live models: set OPENROUTER_API_KEY and run `npm run dev` + `npm run gateway`.'));
  console.log('');
}, 2500);
