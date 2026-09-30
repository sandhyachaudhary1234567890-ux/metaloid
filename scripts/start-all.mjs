import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('[MetaIoid] Starting Gateway on port 8787...');
const gateway = spawn('node', ['server/src/index.js'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

console.log('[MetaIoid] Starting Frontend on port 5173...');
const frontend = spawn('npx', ['vite', '--host', '0.0.0.0'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

process.on('SIGINT', () => {
  gateway.kill();
  frontend.kill();
  process.exit();
});
