// ArtifactService — ONE canonical artifact system (pptx/docx/md/txt).
// Scoped operations only: userId + workspaceId/projectId/taskId/
// conversationId respected; paths are internal ids (never host paths).
// Lifecycle: CREATING → CREATED → VALIDATING → RENDERING → REVIEWING →
// REPAIRING → VERIFIED → FINALIZED, or FAILED. "Complete" is never shown
// before FINALIZED. Renderer: LibreOffice headless if installed (execFile,
// no shell, timeouts, tmp sandbox); otherwise honestly unavailable.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';
import { buildPptx, validatePptxBytes, extractSlides } from './pptx.js';
import { buildDocx, validateDocxBytes } from './docx.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const META = path.join(DIR, 'artifacts.json');
const BYTES = path.join(DIR, 'artifacts');

export const ARTIFACT_KINDS = ['pptx', 'docx', 'md', 'txt'];
export const ARTIFACT_STATES = ['CREATING', 'CREATED', 'VALIDATING', 'RENDERING', 'REVIEWING', 'REPAIRING', 'VERIFIED', 'FINALIZED', 'FAILED'];
const MAX_BYTES = 10_000_000;

function load() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.mkdirSync(BYTES, { recursive: true });
    if (fs.existsSync(META)) return JSON.parse(fs.readFileSync(META, 'utf8'));
  } catch { /* start empty */ }
  return { artifacts: [] };
}
let store = load();
const persist = () => {
  try {
    fs.writeFileSync(META, JSON.stringify(store, null, 1).slice(0, 4_000_000));
  } catch { /* ignore */ }
};

let seq = 0;
const aid = () => `art-${Date.now().toString(36)}-${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function needUser(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');
}

async function supa() {
  const m = await import('./supadb.js');
  return m.dbMode() ? m : null;
}

const SAFE_NAME = /^[a-z0-9][a-z0-9 _.-]{0,80}$/i;
export function safeFilename(name, kind) {
  const base = String(name || 'untitled').replace(/\.[a-z0-9]+$/i, '').trim().slice(0, 60) || 'untitled';
  const clean = SAFE_NAME.test(base) ? base : base.replace(/[^a-z0-9 _.-]+/gi, '_').slice(0, 60) || 'untitled';
  return `${clean}.${kind}`;
}

function bytesPath(a, v) {
  return path.join(BYTES, `${a.id}.v${v}.bin`);
}

async function writeBytes(userId, a, v, buf) {
  if (buf.length > MAX_BYTES) throw new Error('Artifact too large (10MB cap).');
  const db = await supa();
  if (db) {
    await db.artBytesPut(userId, a.id, v, buf, MIME[a.kind] || 'application/octet-stream');
    return;
  }
  fs.writeFileSync(bytesPath(a, v), buf);
}

async function readVersionBytes(userId, a, v) {
  const db = await supa();
  if (db) return db.artBytesGet(userId, a.id, v == null ? a.version : v);
  return fs.readFileSync(bytesPath(a, v == null ? a.version : v));
}

export function readBytes(a, v) {
  return fs.readFileSync(bytesPath(a, v == null ? a.version : v));
}

/** Load the live mutable artifact (either backend). Mutations must sSave(). */
async function loadArtifact(userId, id, scope = {}) {
  const db = await supa();
  if (db) {
    const a = await db.artGet(userId, id);
    if (!a) return null;
    if (scope.projectId && a.projectId !== scope.projectId) return null;
    if (scope.workspaceId && a.workspaceId !== scope.workspaceId) return null;
    return a;
  }
  return owned(store.artifacts.find((a) => a.id === id), userId, scope);
}

async function saveArtifact(a) {
  const db = await supa();
  if (db) {
    await db.artSave(a);
    return;
  }
  persist();
}

async function insertArtifact(a) {
  const db = await supa();
  if (db) {
    await db.artInsert(a);
    return;
  }
  store.artifacts.unshift(a);
  if (store.artifacts.length > 500) store.artifacts.length = 500;
  persist();
}

function owned(a, userId, scope = {}) {
  if (!a || a.userId !== userId) return null;
  if (a.deleted) return null;
  if (scope.projectId && a.projectId !== scope.projectId) return null;
  if (scope.workspaceId && a.workspaceId !== scope.workspaceId) return null;
  return a;
}

export async function getArtifact(userId, id, scope = {}) {
  needUser(userId);
  return loadArtifact(userId, id, scope);
}

export async function listArtifacts(userId, scope = {}) {
  needUser(userId);
  const db = await supa();
  if (db) return (await db.artList(userId, scope)).map((a) => publicArtifact(a));
  return store.artifacts
    .filter((a) => owned(a, userId, scope))
    .map((a) => publicArtifact(a))
    .sort((x, y) => (y.updatedAt > x.updatedAt ? 1 : -1));
}

export function publicArtifact(a) {
  const { ...rest } = a;
  return {
    ...rest,
    downloadUrl: `/api/artifacts/${a.id}/download`,
    versions: (a.versions || []).map((v) => ({ version: v.version, at: v.at, note: v.note, status: v.status })),
  };
}

function setState(a, status, detail = '') {
  a.status = status;
  a.updatedAt = new Date().toISOString();
  a.timeline.push({ at: a.updatedAt, status, detail: String(detail).slice(0, 200) });
  if (a.timeline.length > 60) a.timeline.splice(0, a.timeline.length - 60);
}

/** Create from a deck/doc/markdown spec. No fake bytes — builders throw. */
export async function createArtifact({ userId, kind, name, spec, projectId = null, workspaceId = null, taskId = null, conversationId = null }) {
  needUser(userId);
  if (!ARTIFACT_KINDS.includes(kind)) return { ok: false, error: `Unsupported kind "${kind}". Available: pptx, docx, md, txt.` };
  const a = {
    id: aid(), userId, kind,
    name: safeFilename(name, kind === 'txt' ? 'txt' : kind),
    projectId: projectId || null, workspaceId: workspaceId || null,
    taskId: taskId || null, conversationId: conversationId || null,
    status: 'CREATING', version: 1, versions: [],
    verification: null, renders: [],
    timeline: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    deleted: false,
  };
  setState(a, 'CREATING', `kind=${kind}`);
  try {
    const buf = renderBytes(kind, spec);
    await writeBytes(userId, a, 1, buf);
    a.versions.push({ version: 1, at: a.updatedAt, note: 'created', status: 'CREATED', bytes: buf.length });
    setState(a, 'CREATED', `${buf.length} bytes`);
  } catch (e) {
    setState(a, 'FAILED', String((e && e.message) || e).slice(0, 160));
    await insertArtifact(a);
    emit('artifact.failed', { id: a.id, user: userId });
    return { ok: false, error: String((e && e.message) || e).slice(0, 200), artifact: publicArtifact(a) };
  }
  await insertArtifact(a);
  emit('artifact.created', { id: a.id, user: userId, kind });
  return { ok: true, artifact: publicArtifact(a) };
}

export function renderBytes(kind, spec) {
  if (kind === 'pptx') return buildPptx(spec);
  if (kind === 'docx') return buildDocx(spec);
  if (kind === 'md' || kind === 'txt') {
    const text = String(spec?.text ?? spec?.content ?? '');
    if (!text.trim()) throw new Error('Document needs text content.');
    return Buffer.from(text.slice(0, 500_000), 'utf8');
  }
  throw new Error(`No builder for kind "${kind}".`);
}

/** New version from edited spec (v1 → v2 …). Previous versions preserved. */
export async function editArtifact(userId, id, spec, note = '') {
  const a = await loadArtifact(userId, id);
  if (!a) return { ok: false, error: 'Unknown artifact.' };
  if (!['CREATED', 'REVIEWING', 'VERIFIED', 'FINALIZED', 'FAILED'].includes(a.status)) {
    return { ok: false, error: `Cannot edit while ${a.status}.` };
  }
  try {
    const buf = renderBytes(a.kind, spec);
    a.version += 1;
    await writeBytes(userId, a, a.version, buf);
    a.versions.push({ version: a.version, at: new Date().toISOString(), note: note.slice(0, 120) || 'edited', status: 'CREATED', bytes: buf.length });
    setState(a, 'CREATED', `v${a.version} (${buf.length} bytes)`);
    a.verification = null;
    await saveArtifact(a);
    emit('artifact.edited', { id, user: userId, version: a.version });
    return { ok: true, artifact: publicArtifact(a) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/** Structural validation (never just the extension). */
export async function validateArtifact(userId, id) {
  const a = await loadArtifact(userId, id);
  if (!a) return { ok: false, error: 'Unknown artifact.' };
  setState(a, 'VALIDATING', `v${a.version}`);
  let result;
  try {
    const buf = await readVersionBytes(userId, a, a.version);
    if (a.kind === 'pptx') {
      const v = validatePptxBytes(buf);
      result = { passed: v.ok, checks: v.ok ? ['pkzip', 'content-types', 'presentation-xml', `slides:${v.slideCount}`, 'slide-text'] : [], issues: v.issues, slideCount: v.slideCount, bytes: v.bytes };
    } else if (a.kind === 'docx') {
      const v = validateDocxBytes(buf);
      result = { passed: v.ok, checks: v.ok ? ['pkzip', 'content-types', 'document-xml', `paragraphs:${v.paragraphs}`, 'text-runs'] : [], issues: v.issues, paragraphs: v.paragraphs, bytes: v.bytes };
    } else {
      const text = buf.toString('utf8');
      const issues = [];
      if (!text.trim()) issues.push('empty document');
      result = { passed: issues.length === 0, checks: issues.length ? [] : ['nonempty', 'utf8'], issues, bytes: buf.length };
    }
  } catch (e) {
    result = { passed: false, checks: [], issues: ['unreadable bytes: ' + String((e && e.message) || e).slice(0, 80)], bytes: 0 };
  }
  a.verification = { ...result, at: new Date().toISOString(), version: a.version };
  const vEntry = a.versions.find((v) => v.version === a.version);
  if (vEntry) vEntry.status = result.passed ? 'VALIDATED' : 'FAILED';
  setState(a, result.passed ? 'REVIEWING' : 'FAILED', result.passed ? 'structural checks passed' : result.issues.join('; ').slice(0, 160));
  await saveArtifact(a);
  emit('artifact.validated', { id, user: userId, passed: result.passed });
  return { ok: true, verification: a.verification, artifact: publicArtifact(a) };
}

// ---------- renderer (LibreOffice headless if present, else honest) ----------

let rendererCache = null;
export function detectRenderer() {
  if (rendererCache) return rendererCache;
  return new Promise((resolve) => {
    execFile('soffice', ['--version'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) {
        rendererCache = { available: false, name: null, detail: 'LibreOffice not found on this machine.' };
      } else {
        rendererCache = { available: true, name: 'libreoffice', detail: String(stdout || '').trim().slice(0, 120) };
      }
      resolve(rendererCache);
    });
  });
}

/**
 * Render to PDF proof (+ PNGs when pdftoppm exists). If no renderer:
 * honestly unavailable — structural validation stands on its own.
 */
export async function renderArtifact(userId, id) {
  const a = await loadArtifact(userId, id);
  if (!a) return { ok: false, error: 'Unknown artifact.' };
  if (!['CREATED', 'REVIEWING', 'VERIFIED', 'FINALIZED'].includes(a.status) && !(a.status === 'REVIEWING')) {
    // allow re-render from any non-transient state
  }
  const det = await detectRenderer();
  setState(a, 'RENDERING', det.available ? 'libreoffice' : 'no renderer');
  if (!det.available) {
    a.renders.push({ at: new Date().toISOString(), ok: false, reason: 'visual rendering unavailable in this environment' });
    setState(a, 'REVIEWING', 'render skipped — structural validation stands');
    await saveArtifact(a);
    return {
      ok: true, rendered: false,
      message: `${a.kind.toUpperCase()} created and structurally validated, but visual rendering is unavailable in this environment.`,
      artifact: publicArtifact(a),
    };
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-render-'));
  try {
    const src = path.join(work, `src.${a.kind}`);
    fs.writeFileSync(src, await readVersionBytes(userId, a, a.version));
    await new Promise((resolve, reject) => {
      execFile('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', work, src], { timeout: 60000, windowsHide: true }, (err) => {
        if (err) reject(new Error('convert failed: ' + String(err.message || err).slice(0, 120)));
        else resolve(null);
      });
    });
    const pdfs = fs.readdirSync(work).filter((f) => f.endsWith('.pdf'));
    if (!pdfs.length) throw new Error('no PDF produced');
    const pdf = fs.readFileSync(path.join(work, pdfs[0]));
    // page images when pdftoppm exists (best-effort visual QA input)
    let previews = [];
    try {
      await new Promise((resolve, reject) => {
        execFile('pdftoppm', ['-png', '-r', '48', '-f', '1', '-l', '12', path.join(work, pdfs[0]), path.join(work, 'p')], { timeout: 60000, windowsHide: true }, (err) => {
          if (err) reject(err);
          else resolve(null);
        });
      });
      previews = fs.readdirSync(work).filter((f) => f.endsWith('.png')).map((f) => ({ page: f, bytes: fs.statSync(path.join(work, f)).size }));
    } catch {
      previews = []; // honest: PDF proof only
    }
    a.renders.push({ at: new Date().toISOString(), ok: true, pdfBytes: pdf.length, previews: previews.length, pages: previews.map((p) => p.page) });
    setState(a, 'REVIEWING', `pdf proof (${pdf.length}B)${previews.length ? ` + ${previews.length} previews` : ', no page images'}`);
    await saveArtifact(a);
    emit('artifact.rendered', { id, user: userId, previews: previews.length });
    return { ok: true, rendered: true, pdfBytes: pdf.length, previews: previews.length, artifact: publicArtifact(a) };
  } catch (e) {
    a.renders.push({ at: new Date().toISOString(), ok: false, reason: String((e && e.message) || e).slice(0, 160) });
    setState(a, 'REVIEWING', 'render failed — structural validation stands');
    await saveArtifact(a);
    return { ok: true, rendered: false, message: `Render failed (${String((e && e.message) || e).slice(0, 120)}). File remains structurally validated.`, artifact: publicArtifact(a) };
  } finally {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

/** XML-level visual QA (works without renderer) + render-aware notes. */
export async function visualQA(userId, id) {
  const a = await loadArtifact(userId, id);
  if (!a) return { ok: false, error: 'Unknown artifact.' };
  const issues = [];
  try {
    const buf = await readVersionBytes(userId, a, a.version);
    if (a.kind === 'pptx') {
      const slides = extractSlides(buf);
      for (const s of slides) {
        const paras = (s.xml.match(/<a:p>/g) || []).length;
        const chars = (s.xml.match(/<a:t>[^<]*<\/a:t>/g) || []).join('').replace(/<[^>]+>/g, '').length;
        if (!/<a:t>[^<]+<\/a:t>/.test(s.xml)) issues.push({ slide: s.name, reason: 'empty slide — no text (dead region)' });
        if (paras > 8) issues.push({ slide: s.name, reason: `overcrowded (${paras} paragraphs — overflow/clipping risk)` });
        if (chars > 900) issues.push({ slide: s.name, reason: `dense text (~${chars} chars — tiny-text risk)` });
      }
      if (!slides.length) issues.push({ slide: '-', reason: 'no slides parsed' });
    } else if (a.kind === 'docx') {
      const text = buf.toString('latin1');
      const paras = (text.match(/<w:p[\s>]/g) || []).length;
      if (!paras) issues.push({ slide: '-', reason: 'no paragraphs' });
    }
  } catch (e) {
    issues.push({ slide: '-', reason: 'unreadable: ' + String((e && e.message) || e).slice(0, 80) });
  }
  const lastRender = a.renders[a.renders.length - 1];
  return {
    ok: true, issues,
    allPassed: issues.length === 0,
    renderNote: !lastRender
      ? 'never rendered — pixel checks (overflow/clipping/overlap/contrast) unavailable'
      : lastRender.ok && lastRender.previews
        ? `${lastRender.previews} page previews available for Vision review`
        : 'PDF proof only — pixel checks unavailable',
    artifact: publicArtifact(a),
  };
}

/** Bound repair: trim overcrowded slides (pptx) then re-validate. */
export async function repairArtifact(userId, id) {
  const a = await loadArtifact(userId, id);
  if (!a) return { ok: false, error: 'Unknown artifact.' };
  if (a.kind !== 'pptx') return { ok: false, error: 'Auto-repair currently supports pptx only.' };
  const repairs = Number(a.repairs || 0);
  if (repairs >= 2) return { ok: false, error: 'Repair budget exhausted (2 attempts).' };
  try {
    const slides = extractSlides(await readVersionBytes(userId, a, a.version));
    // rebuild spec from current XML: titles + trimmed bullets
    const spec = { title: a.name.replace(/\.pptx$/i, ''), slides: [] };
    const titleOf = (xml) => {
      const m = xml.match(/<a:t>([^<]{1,120})<\/a:t>/);
      return m ? m[1] : 'Untitled';
    };
    for (const s of slides) {
      const texts = [...s.xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).filter((t) => t.trim());
      const bullets = texts.slice(1, 7);
      // de-escape basic entities for rebuild
      const un = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      spec.slides.push({ title: un(titleOf(s.xml)), bullets: bullets.map(un) });
    }
    const buf = renderBytes('pptx', spec);
    a.version += 1;
    await writeBytes(userId, a, a.version, buf);
    a.repairs = repairs + 1;
    a.versions.push({ version: a.version, at: new Date().toISOString(), note: 'auto-repair: trimmed overcrowded slides', status: 'CREATED', bytes: buf.length });
    setState(a, 'REPAIRING', `v${a.version}`);
    await saveArtifact(a);
    const v = await validateArtifact(userId, id);
    return { ok: true, repairs: a.repairs, verification: v.verification, artifact: publicArtifact(await loadArtifact(userId, id)) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/** Targeted slide edit (pptx): replace title/bullets of slide N, new version. */
export async function editSlide(userId, id, n, { title, bullets } = {}) {
  const a = await loadArtifact(userId, id);
  if (!a) return { ok: false, error: 'Unknown artifact.' };
  if (a.kind !== 'pptx') return { ok: false, error: 'Slide editing supports pptx only.' };
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 40) return { ok: false, error: 'Slide number must be 1–40.' };
  try {
    const slides = extractSlides(await readVersionBytes(userId, a, a.version));
    if (num > slides.length) return { ok: false, error: `Deck has ${slides.length} slides — no slide ${num}.` };
    const un = (t) => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    const spec = {
      title: a.name.replace(/\.pptx$/i, ''),
      slides: slides.map((s, i) => {
        const texts = [...s.xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => un(m[1])).filter((t) => t.trim());
        if (i === num - 1) {
          return {
            title: title !== undefined ? String(title).slice(0, 120) : texts[0] || `Slide ${num}`,
            bullets: bullets !== undefined ? bullets.map((b) => String(b).slice(0, 300)).slice(0, 8) : texts.slice(1, 7),
          };
        }
        return { title: texts[0] || `Slide ${i + 1}`, bullets: texts.slice(1, 7) };
      }),
    };
    const buf = renderBytes('pptx', spec);
    a.version += 1;
    await writeBytes(userId, a, a.version, buf);
    a.versions.push({ version: a.version, at: new Date().toISOString(), note: `edited slide ${num}`, status: 'CREATED', bytes: buf.length });
    setState(a, 'CREATED', `v${a.version} (slide ${num} edited)`);
    a.verification = null;
    await saveArtifact(a);
    emit('artifact.slide_edited', { id, user: userId, slide: num });
    return { ok: true, artifact: publicArtifact(a) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/** Finalize only from VERIFIED (or REVIEWING with passed verification). */
export async function finalizeArtifact(userId, id, projectId = null) {
  const a = await loadArtifact(userId, id);
  if (!a) return { ok: false, error: 'Unknown artifact.' };
  const v = a.verification;
  if (!v || !v.passed || v.version !== a.version) {
    return { ok: false, error: 'Finalize requires passing validation on the current version. Validate first.' };
  }
  if (projectId) a.projectId = String(projectId).slice(0, 80);
  setState(a, 'FINALIZED', projectId ? `project=${a.projectId}` : 'no project');
  await saveArtifact(a);
  emit('artifact.finalized', { id, user: userId, project: a.projectId });
  return { ok: true, artifact: publicArtifact(a) };
}

/** Records a terminal failure without exposing filesystem details to callers. */
export async function failArtifact(userId, id, reason = 'Artifact verification failed.') {
  const a = await loadArtifact(userId, id);
  if (!a) return null;
  setState(a, 'FAILED', String(reason).slice(0, 180));
  a.errors = [...(a.errors || []), { at: a.updatedAt, message: String(reason).slice(0, 300) }].slice(-12);
  await saveArtifact(a);
  emit('artifact.failed', { id, user: userId, reason: String(reason).slice(0, 80) });
  return publicArtifact(a);
}

export async function deleteArtifact(userId, id) {
  const a = await loadArtifact(userId, id);
  if (!a) return false;
  a.deleted = true;
  setState(a, 'FAILED', 'deleted by user');
  await saveArtifact(a);
  // bytes: tombstoned metadata stays for audit; version bytes removed
  try {
    const db = await supa();
    if (db) {
      await db.artBytesDel(userId, [id]);
    } else {
      for (const v of a.versions || []) {
        try {
          fs.unlinkSync(bytesPath(a, v.version));
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  emit('artifact.deleted', { id, user: userId });
  return true;
}

export async function downloadArtifact(userId, id) {
  const a = await loadArtifact(userId, id);
  if (!a) return null;
  return { artifact: publicArtifact(a), bytes: await readVersionBytes(userId, a, a.version) };
}

export async function deleteUserArtifacts(userId) {
  const db = await supa();
  if (db) {
    const ids = await db.artDeleteUser(userId);
    if (ids.length) await db.artBytesDel(userId, ids).catch(() => {});
    return ids.length;
  }
  const mine = store.artifacts.filter((a) => a.userId === userId);
  for (const a of mine) {
    for (const v of a.versions || []) {
      try {
        fs.unlinkSync(bytesPath(a, v.version));
      } catch { /* ignore */ }
    }
  }
  store.artifacts = store.artifacts.filter((a) => a.userId !== userId);
  persist();
  return mine.length;
}

export const MIME = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};
