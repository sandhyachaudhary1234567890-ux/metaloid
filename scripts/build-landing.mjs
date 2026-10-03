// Copies the marketing page into the build output so `dist/` is a complete
// deployable artifact: dist/index.html (landing) + dist/app/ (the product).
//
// Vercel and any static host can then serve the repo root as-is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'landing');
const OUT = path.join(ROOT, 'dist');

if (!fs.existsSync(path.join(OUT, 'app', 'index.html'))) {
  console.error('[landing] dist/app/index.html is missing — run `vite build` first.');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
for (const entry of fs.readdirSync(SRC)) {
  const from = path.join(SRC, entry);
  const to = path.join(OUT, entry);
  fs.cpSync(from, to, { recursive: true });
}

console.log('[landing] copied landing/ → dist/  (site at /, app at /app/)');
