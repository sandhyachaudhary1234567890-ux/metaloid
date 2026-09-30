// Artifact + activity matrix: real bytes, validation, versions, isolation,
// traversal blocks, renderer honesty, tool execution, pipeline w/ explicit
// slides (no model spend), activity engine semantics. Self-isolating.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.METALOID_DATA_DIR) {
  process.env.METALOID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-art-'));
}

const pass = (n) => console.log('PASS', n);
const users = await import('../src/core/users.js');
const art = await import('../src/core/artifacts.js');
const tools = await import('../src/core/tools.js');
await import('../src/tools/catalog.js'); // register all tools
const skills = await import('../src/core/skillStore.js');
const disc = await import('../src/core/skillDiscovery.js');

const A = users.createUser({ handle: 'arta', passcode: 'pass1234' }).user.id;
const B = users.createUser({ handle: 'artb', passcode: 'pass1234' }).user.id;

const DECK = {
  title: 'Afforestation',
  slides: Array.from({ length: 10 }, (_, i) => ({
    title: `Slide ${i + 1}: ${['Why Forests Matter', 'The Problem', 'The Plan', 'Species', 'Community', 'Timeline', 'Budget', 'Risks', 'Impact', 'Join Us'][i]}`,
    bullets: [`Point A on slide ${i + 1}`, `Point B on slide ${i + 1}`, `Point C on slide ${i + 1}`],
  })),
  accent: '1F6B3A',
};

// ---- real pptx bytes + validation ----
const c1 = art.createArtifact({ userId: A, kind: 'pptx', name: 'Afforestation', spec: DECK, projectId: 'School', conversationId: 'c1' });
assert.equal(c1.ok, true, 'create ok: ' + (c1.error || ''));
assert.equal(c1.artifact.status, 'CREATED');
const raw = art.readBytes({ id: c1.artifact.id, version: 1 });
assert.equal(raw.readUInt32LE(0), 0x04034b50, 'PKZIP signature');
const v1 = art.validateArtifact(A, c1.artifact.id);
assert.equal(v1.ok, true);
assert.equal(v1.verification.passed, true, 'validates: ' + v1.verification.issues.join(';'));
assert.equal(v1.verification.slideCount, 10, 'slide count 10');
pass('real .pptx bytes + structural validation (10 slides)');

// ---- corrupt rejected ----
const bad = art.createArtifact({ userId: A, kind: 'pptx', name: 'empty', spec: { title: '', slides: [] } });
assert.equal(bad.ok, false, 'empty deck refused');
assert.equal(bad.artifact.status, 'FAILED', 'failed state recorded, not fake-complete');
pass('invalid deck refused with FAILED (never fake-complete)');

// ---- finalize gating ----
const c2 = art.createArtifact({ userId: A, kind: 'pptx', name: 'Gate', spec: DECK });
const fBlocked = art.finalizeArtifact(A, c2.artifact.id);
assert.equal(fBlocked.ok, false, 'finalize blocked pre-validation');
art.validateArtifact(A, c2.artifact.id);
const fOk = art.finalizeArtifact(A, c2.artifact.id, 'School');
assert.equal(fOk.ok, true);
assert.equal(fOk.artifact.status, 'FINALIZED');
assert.equal(fOk.artifact.projectId, 'School', 'project association');
pass('finalize gated on validation + project association');

// ---- versions: edit → revalidate ----
const e1 = art.editArtifact(A, c1.artifact.id, { ...DECK, slides: DECK.slides.map((s, i) => (i === 5 ? { ...s, title: 'Slide 6: FIXED Timeline', bullets: ['Revised point'] } : s)) }, 'fix slide 6');
assert.equal(e1.ok, true);
assert.equal(e1.artifact.version, 2, 'v2 created');
const vv = art.validateArtifact(A, c1.artifact.id);
assert.equal(vv.ok && vv.verification.passed, true, 'v2 re-validates');
assert.equal(art.getArtifact(A, c1.artifact.id).versions.length, 2, 'history preserved');
pass('edit → v2 → revalidate, history preserved');

// ---- docx real ----
const d1 = art.createArtifact({
  userId: A, kind: 'docx', name: 'Afforestation notes',
  spec: { title: 'Afforestation', blocks: [{ h: 1, text: 'Why' }, { p: 'Forests matter.' }, { bullets: ['Plant', 'Water', 'Protect'] }] },
});
assert.equal(d1.ok, true);
const dv = art.validateArtifact(A, d1.artifact.id);
assert.equal(dv.ok && dv.verification.passed, true, 'docx validates: ' + (dv.verification.issues || []).join(';'));
const draw = art.readBytes({ id: d1.artifact.id, version: 1 });
assert.ok(draw.toString('latin1').includes('word/document.xml'), 'docx package structure');
pass('real .docx bytes + validation');

// ---- isolation ----
assert.equal(art.getArtifact(B, c1.artifact.id), null, 'B cannot read A artifact');
assert.equal(art.listArtifacts(B).length, 0, 'B list empty');
assert.equal(art.deleteArtifact(B, c1.artifact.id), false, 'B cannot delete');
assert.equal(art.validateArtifact(B, c1.artifact.id).ok, false, 'B cannot validate');
const dlB = art.downloadArtifact(B, c1.artifact.id);
assert.equal(dlB, null, 'B cannot download bytes');
pass('cross-user artifact isolation');

// ---- scoped names, no traversal ----
const evil = art.createArtifact({ userId: A, kind: 'md', name: '../../etc/evil', spec: { text: 'x' } });
assert.equal(evil.ok, true);
assert.ok(!evil.artifact.name.includes('/') && evil.artifact.name.endsWith('.md'), 'filename sanitized: ' + evil.artifact.name);
pass('filename sanitization (no traversal)');

// ---- renderer honesty ----
const det = await art.detectRenderer();
assert.ok(typeof det.available === 'boolean', 'detection returns verdict');
const r1 = await art.renderArtifact(A, c1.artifact.id);
assert.equal(r1.ok, true);
if (!det.available) {
  assert.equal(r1.rendered, false);
  assert.ok(/unavailable in this environment/.test(r1.message), 'honest unavailable message');
  pass(`renderer honesty (absent → "${r1.message.slice(0, 60)}…")`);
} else {
  assert.equal(r1.rendered, true);
  pass(`renderer present (pdf ${r1.pdfBytes}B, ${r1.previews} previews)`);
}

// ---- visual QA (XML-level, no renderer needed) ----
const qa = art.visualQA(A, c1.artifact.id);
assert.equal(qa.ok, true);
assert.ok(Array.isArray(qa.issues), 'issues array');
assert.ok(typeof qa.renderNote === 'string' && qa.renderNote.length > 0, 'render note honest');
pass('visual QA structure + render note');

// ---- tools execute for real (AgentRuntime bridge) ----
const t1 = await tools.executeTool('presentation.create', { title: 'Tool Deck', slides: DECK.slides.slice(0, 3) }, { userId: A });
assert.equal(t1.ok, true, 'presentation.create executes: ' + (t1.error || ''));
assert.ok(t1.result.artifact.id, 'returns artifact id');
const t2 = await tools.executeTool('presentation.validate', { id: t1.result.artifact.id }, { userId: A });
assert.equal(t2.ok && t2.result.verification.passed, true, 'tool-chain validate passes');
const t3 = await tools.executeTool('artifact.finalize', { id: t1.result.artifact.id, projectId: 'School' }, { userId: A });
assert.equal(t3.ok && t3.result.artifact.status, 'FINALIZED', 'tool-chain finalize');
const tAnon = await tools.executeTool('presentation.create', { title: 'X', slides: DECK.slides.slice(0, 2) }, {});
assert.equal(tAnon.ok, false, 'anonymous tool call refused');
const tNope = await tools.executeTool('spreadsheet.create', {}, { userId: A });
assert.equal(tNope.ok, false, 'unregistered tool is NOT callable');
pass('ToolRegistry bridge: create→validate→finalize; anon + unregistered refused');

// ---- skill deps now resolve against the real catalog ----
const sp = skills.installSkill(A, {
  manifest: {
    name: 'Preso', description: 'Build slide presentations from outlines whenever the user asks for slides.',
    version: '1.0.0', types: ['creative'], tools: ['presentation.create', 'artifact.validate'],
    triggers: ['presentation', 'slides'], dependencies: { tools: [], plugins: [], providers: [], packages: [] },
  },
  instructions: 'x', references: {}, scripts: {}, files: {},
  security: { risk: 'low', findings: [] },
}, { scope: 'user', source: 'created' });
assert.equal(sp.ok, true);
const miss = disc.missingDeps({ ...sp.skill, tools: ['presentation.create', 'artifact.validate'], dependencies: { tools: [], plugins: [], providers: [] } }, {});
assert.deepEqual(miss.tools, [], 'catalog tools resolve (was: blocked)');
const d = disc.discoverFor(A, 'make a slide presentation about afforestation with outlines please');
assert.ok(d.some((c) => c.name === 'Preso' && c.auto), 'presentation skill auto-matches');
pass('skill dependency resolution against real catalog');

// ---- delete + cascade ----
assert.equal(art.deleteArtifact(A, c1.artifact.id), true);
assert.equal(art.getArtifact(A, c1.artifact.id), null, 'deleted gone');
const n = art.deleteUserArtifacts(A);
assert.ok(n >= 3, 'cascade removes all, got ' + n);
assert.equal(art.listArtifacts(A).length, 0);
pass('delete + user cascade');

// ---- activity engine semantics (pure unit; Node strips erasable TS) ----
const act = await import('../../src/lib/activity.ts');
{
  const tid = 't-unit-1';
  act.startTask(tid, 'artifact');
  assert.deepEqual(act.stagesOf(tid).stages, [], 'no stages before events (never invented)');
  act.emitActivity(tid, 'artifact', 'EXECUTE', 'running', 'Building file');
  let st = act.stagesOf(tid);
  assert.equal(st.stages.length, 1, 'only arrived stage renders');
  assert.equal(st.stages[0].status, 'running');
  assert.equal(st.ended, false, 'not ended mid-task');
  act.emitActivity(tid, 'artifact', 'UNDERSTAND', 'done', 'Understood late');
  st = act.stagesOf(tid);
  assert.equal(st.stages[0].phase, 'UNDERSTAND', 'canonical phase order regardless of arrival');
  act.emitActivity(tid, 'artifact', 'FINALIZE', 'done', 'Done');
  assert.equal(act.stagesOf(tid).ended, true, 'FINALIZE done ends task');
  act.endTask(tid);
  assert.equal(act.stagesOf(tid), null, 'cleanup removes task');
  pass('activity engine: no invented stages, ordered, terminating, cleaned');

  // one-line mapper: internal phases → small human set, real-events only
  const m1 = 't-map-1';
  act.startTask(m1, 'chat');
  assert.equal(act.simpleViewOf(m1).label, 'Thinking…', 'chat → Thinking…');
  assert.deepEqual(act.simpleViewOf(m1).lines, [], 'no lines before events');
  act.emitActivity(m1, 'chat', 'EXECUTE', 'running', 'Answering');
  assert.equal(act.simpleViewOf(m1).label, 'Thinking…', 'line stable (kind-level, no flicker)');
  assert.equal(act.simpleViewOf(m1).lines.length, 1, 'one arrived stage in summary');
  act.renameTask(m1, 'presentation');
  assert.equal(act.simpleViewOf(m1).label, 'Creating your presentation…', 'rename → presentation line');
  act.emitActivity(m1, 'presentation', 'FINALIZE', 'done', 'Done');
  assert.equal(act.simpleViewOf(m1).label, 'Done', 'completion → Done');
  const m2 = 't-map-2';
  act.startTask(m2, 'research');
  assert.equal(act.simpleViewOf(m2).label, 'Researching…', 'research → Researching…');
  act.emitActivity(m2, 'research', 'EXECUTE', 'error', 'Search failed', 'upsteam 500');
  const mv = act.simpleViewOf(m2);
  assert.equal(mv.label, 'Couldn’t complete this task', 'error → one calm line');
  assert.ok(mv.lines[0].detail.includes('upsteam'), 'expanded shows safe detail only');
  act.endTask(m1);
  act.endTask(m2);
  pass('one-line mapper: kind labels, done/error, safe summary only');
}

console.log('\nALL ARTIFACT TESTS PASSED');
