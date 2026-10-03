import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copies the hand-written marketing page into the build output, so `dist/`
// serves the site at `/` and the product at `/app/` from one deployment.
// The app itself is built by Vite with `base: '/app/'`.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'landing');
const to = join(root, 'dist');

function copy(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) copy(s, d);
    else copyFileSync(s, d);
  }
}

copy(from, to);
console.log('[landing] copied landing/ → dist/  (site at /, app at /app/)');
