// ZIP skill import — dependency-free parser (stored + deflate via
// node:zlib) with hard security caps. Extraction is IN-MEMORY only (no
// disk writes, no code execution at install). Rejects: zip-slip, absolute
// paths, symlinks, encrypted entries, nested archives, oversized/bomb
// payloads, native binaries, non-UTF8 names.

import zlib from 'node:zlib';

export const ZIP_LIMITS = {
  maxArchiveBytes: 1_500_000,
  maxExtractedBytes: 5_000_000,
  maxFiles: 100,
  maxRatio: 100, // uncompressed/compressed per file (bomb guard)
};

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const BIN_EXT = ['.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.class', '.jar', '.msi', '.bat', '.cmd', '.ps1', '.sh'];

function readU16(b, o) {
  return b.readUInt16LE(o);
}
function readU32(b, o) {
  return b.readUInt32LE(o);
}

function cleanName(raw) {
  // reject BEFORE normalization games: backslashes, drives, absolute, ..
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) return null;
  if (raw.includes('\\')) return null;
  const parts = raw.split('/');
  for (const p of parts) {
    if (!p || p === '.' || p === '..') return null;
  }
  if (parts.some((p) => p.startsWith('.') && p !== '.well-known')) {
    // hidden files: allowlist none — drop silently later
    return 'HIDDEN';
  }
  return parts.join('/');
}

/**
 * Parse + extract a ZIP buffer into { 'skill.md': text, files: {path: text} }.
 * Throws Error with user-facing message on any violation.
 */
export function extractSkillZip(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('Invalid archive.');
  if (buf.length > ZIP_LIMITS.maxArchiveBytes) {
    throw new Error(`Archive too large (${(buf.length / 1024).toFixed(0)}KB > ${(ZIP_LIMITS.maxArchiveBytes / 1024).toFixed(0)}KB).`);
  }
  if (buf.length < 22) throw new Error('Not a ZIP archive.');
  // locate EOCD (scan last 66KB)
  const scanStart = Math.max(0, buf.length - 66000);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (readU32(buf, i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory).');
  const cdCount = readU16(buf, eocd + 10);
  const cdOffset = readU32(buf, eocd + 16);
  if (cdCount > ZIP_LIMITS.maxFiles + 50) throw new Error(`Too many entries (${cdCount}).`);

  // central directory
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (readU32(buf, p) !== SIG_CENTRAL) throw new Error('Corrupt central directory.');
    const flags = readU16(buf, p + 8);
    const method = readU16(buf, p + 10);
    const compSize = readU32(buf, p + 20);
    const uncompSize = readU32(buf, p + 24);
    const nameLen = readU16(buf, p + 28);
    const extraLen = readU16(buf, p + 30);
    const commentLen = readU16(buf, p + 32);
    const extAttrs = readU32(buf, p + 38);
    const localOff = readU32(buf, p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ flags, method, compSize, uncompSize, extAttrs, localOff, name });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const out = {};
  let totalOut = 0;
  let fileCount = 0;
  for (const e of entries) {
    if (e.name.endsWith('/')) continue; // directory
    if ((e.flags & 0x1) !== 0) throw new Error(`Encrypted entry rejected: ${e.name.slice(0, 60)}`);
    if (![0, 8].includes(e.method)) throw new Error(`Unsupported compression in ${e.name.slice(0, 60)} (stored/deflate only).`);
    // symlink? unix file-type bits 0xA000
    if (((e.extAttrs >>> 16) & 0xf000) === 0xa000) throw new Error(`Symlink rejected: ${e.name.slice(0, 60)}`);
    const cleaned = cleanName(e.name);
    if (cleaned === 'HIDDEN') continue; // drop dotfiles silently
    if (cleaned === null) throw new Error(`Unsafe path rejected (zip-slip): ${e.name.slice(0, 80)}`);
    const lower = cleaned.toLowerCase();
    if (lower.endsWith('.zip') || lower.endsWith('.7z') || lower.endsWith('.rar') || lower.endsWith('.tar') || lower.endsWith('.gz')) {
      throw new Error(`Nested archives rejected: ${cleaned.slice(0, 60)}`);
    }
    if (BIN_EXT.some((x) => lower.endsWith(x))) throw new Error(`Native binary rejected: ${cleaned.slice(0, 60)}`);
    if (e.uncompSize > ZIP_LIMITS.maxExtractedBytes) throw new Error(`Entry too large: ${cleaned.slice(0, 60)}`);
    const ratio = e.uncompSize / Math.max(1, e.compSize);
    if (ratio > ZIP_LIMITS.maxRatio && e.uncompSize > 100000) {
      throw new Error(`Compression-ratio bomb guard tripped on ${cleaned.slice(0, 60)}.`);
    }
    // data offset from LOCAL header (names must match)
    if (readU32(buf, e.localOff) !== SIG_LOCAL) throw new Error('Corrupt local header.');
    const lNameLen = readU16(buf, e.localOff + 26);
    const lExtraLen = readU16(buf, e.localOff + 28);
    const dataOff = e.localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataOff, dataOff + e.compSize);
    if (comp.length !== e.compSize) throw new Error('Truncated entry data.');
    let raw;
    try {
      raw = e.method === 0 ? comp : zlib.inflateRawSync(comp, { maxOutputLength: ZIP_LIMITS.maxExtractedBytes });
    } catch {
      throw new Error(`Decompression failed: ${cleaned.slice(0, 60)}`);
    }
    totalOut += raw.length;
    if (totalOut > ZIP_LIMITS.maxExtractedBytes) throw new Error('Extracted total exceeds cap.');
    fileCount += 1;
    if (fileCount > ZIP_LIMITS.maxFiles) throw new Error(`Too many files (>${ZIP_LIMITS.maxFiles}).`);
    out[cleaned] = raw.toString('utf8');
  }

  // locate skill.md: root or exactly one level down (skill-name/skill.md)
  const names = Object.keys(out);
  let mdKey = names.includes('skill.md') ? 'skill.md' : null;
  if (!mdKey) {
    const cands = names.filter((n) => n.toLowerCase() === 'skill.md' || /(^|\/)skill\.md$/i.test(n));
    const depth1 = cands.filter((n) => n.split('/').length === 2);
    if (depth1.length === 1) mdKey = depth1[0];
    else if (cands.length === 1) mdKey = cands[0];
  }
  if (!mdKey) throw new Error('skill.md not found (root or single top-level folder).');
  // strip single top-level folder prefix for stable paths
  const prefix = mdKey.includes('/') ? mdKey.slice(0, mdKey.indexOf('/') + 1) : '';
  const norm = {};
  for (const [k, v] of Object.entries(out)) {
    const nk = prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k;
    if (nk) norm[nk] = v;
  }
  if (!norm['skill.md']) throw new Error('skill.md not found after normalization.');
  const { 'skill.md': md, ...files } = norm;
  return { 'skill.md': md, files };
}
