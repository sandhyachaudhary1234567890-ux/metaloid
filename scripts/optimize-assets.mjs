#!/usr/bin/env node
/**
 * MetaIoid asset pipeline.
 *
 * Source artwork lives in `art-src/` as compact masters and is never served.
 * This script derives every shipped asset in `public/art/` from those masters
 * so the product never serves a multi-megabyte PNG.
 *
 * For each artwork it emits a 1x and a 2x WebP at the size the UI actually
 * renders at, and nothing else.
 *
 * Note on presentation: the studio ground in these pieces is a mid-tone that
 * matches neither the dark nor the light page, so alpha-feathering them into
 * the background produces a visible vignette ring. They are therefore framed
 * in the UI as placed artwork — an inset tile with a hairline border — which
 * is honest about what they are and reads the same in both themes.
 *
 * Run:  node scripts/optimize-assets.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'art-src');
const OUT = path.join(ROOT, 'public', 'art');

/**
 * The artwork catalogue. `max` is the largest CSS pixel size the asset is ever
 * rendered at, so the 2x derivative is exactly what a retina display needs and
 * nothing more.
 */
const CATALOGUE = [
  // Welcome / atmosphere — the largest artwork in the product.
  { name: 'atmosphere', src: 'atmosphere.jpg', dir: 'brand', max: 232, focus: 'attention' },

  // Onboarding — shown once, at a comfortable size.
  { name: 'welcome', src: 'welcome.jpg', dir: 'onboarding', max: 300, focus: 'attention' },

  // Empty states — small, quiet, always beside copy rather than above it.
  { name: 'conversations', src: 'conversations.jpg', dir: 'empty-states', max: 148, focus: 'attention' },
  { name: 'files', src: 'files.jpg', dir: 'empty-states', max: 148, focus: 'attention' },
  { name: 'memory', src: 'memory.jpg', dir: 'empty-states', max: 148, focus: 'attention' },
  { name: 'projects', src: 'projects.jpg', dir: 'empty-states', max: 148, focus: 'attention' },
  { name: 'sources', src: 'sources.jpg', dir: 'research', max: 148, focus: 'attention' },

  // System states.
  { name: 'providers', src: 'providers.jpg', dir: 'system', max: 148, focus: 'attention' },
  { name: 'unavailable', src: 'unavailable.jpg', dir: 'system', max: 148, focus: 'attention' },
];

async function build(item) {
  const srcPath = path.join(SRC, item.src);
  if (!fs.existsSync(srcPath)) {
    console.warn(`  ! missing master: art-src/${item.src} — skipped`);
    return 0;
  }

  const dir = path.join(OUT, item.dir);
  fs.mkdirSync(dir, { recursive: true });

  let total = 0;

  for (const scale of [1, 2]) {
    const size = item.max * scale;
    const dest = path.join(dir, `${item.name}-${scale}x.webp`);

    const buf = await sharp(srcPath)
      .resize(size, size, {
        fit: 'cover',
        position: item.focus === 'attention' ? 'attention' : 'centre',
        kernel: 'lanczos3',
      })
      .webp({ quality: 86, effort: 6 })
      .toBuffer();

    fs.writeFileSync(dest, buf);
    total += buf.length;
    console.log(`  ${path.relative(ROOT, dest).padEnd(46)} ${(buf.length / 1024).toFixed(1)} KB`);
  }

  return total;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('art-src/ not found — nothing to optimise.');
    process.exit(1);
  }

  console.log('MetaIoid assets →\n');
  let total = 0;
  for (const item of CATALOGUE) total += await build(item);

  console.log(`\ntotal shipped artwork: ${(total / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
