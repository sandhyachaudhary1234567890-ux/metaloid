#!/usr/bin/env node
/**
 * Launcher-icon generator (maintainer tool, not part of the build).
 *
 * The Android client must wear the *existing* MetaIoid mark, not a redrawn
 * lookalike. The brand asset (public/brand/metaloid-mark.png) is **black ink on
 * transparency** — the mark as it appears on paper. So the platform icon is the
 * original pairing: the black mark on a **white** plate.
 *
 * The first version of this script used the dark page colour as the plate, which
 * produced a black mark on near-black: an invisible icon. The web client does the
 * same thing correctly with `dark:invert` on the `<img>`; a launcher icon has no
 * such filter, so the colour has to be chosen when the file is written.
 *
 *   mipmap-<density>/ic_launcher.png             legacy square icon
 *   mipmap-<density>/ic_launcher_round.png       legacy round icon
 *   mipmap-<density>/ic_launcher_foreground.png  adaptive-icon foreground
 *
 * Nothing here runs in CI: the generated PNGs are committed, so a build never
 * depends on an image toolchain. Re-run it only when the brand asset changes:
 *
 *   npm install sharp --prefix /tmp/icongen && \
 *   node android/tools/generate-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || 'sharp');

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MARK = path.join(ROOT, 'public', 'brand', 'metaloid-mark.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

/** Legacy icon sizes per density bucket. */
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** Adaptive foreground canvas: 108dp, with the mark inside the 66dp safe zone. */
const ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

/**
 * The plate. White, because the mark is black ink — the original pairing, and the
 * only one where the glyph is legible on any launcher wallpaper.
 */
const BG = { r: 0xff, g: 0xff, b: 0xff, alpha: 1 };

async function main() {
  await readFile(MARK); // fail loudly if the brand asset moved
  for (const [density, size] of Object.entries(LEGACY)) {
    const dir = path.join(RES, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });

    // Legacy square: mark at 62% on the brand background.
    const square = await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
      .composite([{ input: await mark(size * 0.62), gravity: 'center' }])
      .png()
      .toBuffer();
    await writeFile(path.join(dir, 'ic_launcher.png'), square);
    await writeFile(path.join(dir, 'ic_launcher_round.png'), square); // the launcher masks it

    // Adaptive foreground: transparent canvas, mark at 52% (inside the safe zone).
    const canvas = ADAPTIVE[density];
    const foreground = await sharp({
      create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: await mark(canvas * 0.52), gravity: 'center' }])
      .png()
      .toBuffer();
    await writeFile(path.join(dir, 'ic_launcher_foreground.png'), foreground);

    console.log(`mipmap-${density}: ${size}px icon, ${canvas}px adaptive foreground`);
  }
}

async function mark(size) {
  // Trim the transparent margin, then re-pad, so the mark fills its box
  // consistently at every density.
  return sharp(MARK).trim({ threshold: 1 }).resize({ width: Math.round(size), fit: 'inside' }).png().toBuffer();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
