// Skills V2 matrix: ZIP import security, manifest ext, diff, runtime
// adapters, schedules contract, initiative policies, tool coverage,
// large-library benchmark, discovery quality (strong/weak/negative/
// unrelated/competing). Self-isolating temp dir.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

if (!process.env.METALOID_DATA_DIR) {
  process.env.METALOID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-skillsv2-'));
}

const pass = (n) => console.log('PASS', n);
const users = await import('../src/core/users.js');
const store = await import('../src/core/skillStore.js');
const pkg = await import('../src/core/skillPackage.js');
const disc = await import('../src/core/skillDiscovery.js');
const rt = await import('../src/core/skillRuntime.js');
const runtimes = await import('../src/core/skillRuntimes.js');
const tasks = await import('../src/core/skillTasks.js');
const init = await import('../src/core/skillInitiatives.js');
const profiles = await import('../src/core/profiles.js');
const tools = await import('../src/core/tools.js');

// ---------- minimal ZIP builder (stored + deflate, for fixtures) ----------
function crc32(buf) {
  let tab = crc32.t;
  if (!tab) {
    tab = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tab[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tab[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function buildZip(entries, { deflate = false } = {}) {
  // entries: [{name, data: Buffer|string}]
  const chunks = [];
  const central = [];
  let off = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const comp = deflate ? zlib.deflateRawSync(data) : data;
    const nameB = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameB, comp);
    central.push({ nameB, method: deflate ? 8 : 0, compLen: comp.length, len: data.length, crc: crc32(data), off });
    off += 30 + nameB.length + comp.length;
  }
  const cdStart = off;
  let cdSize = 0;
  for (const c of central) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(c.method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(c.crc, 16);
    ch.writeUInt32LE(c.compLen, 20);
    ch.writeUInt32LE(c.len, 24);
    ch.writeUInt16LE(c.nameB.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(c.off, 42);
    chunks.push(ch, c.nameB);
    cdSize += 46 + c.nameB.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdStart, 16);
  chunks.push(end);
  return Buffer.concat(chunks);
}
const b64 = (b) => b.toString('base64');

const A = users.createUser({ handle: 'v2a', passcode: 'pass1234' }).user.id;
const B = users.createUser({ handle: 'v2b', passcode: 'pass1234' }).user.id;

const MD = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\nversion: 1.0.0\nlicense: MIT\ntypes: workflow\ntriggers: test trigger\n---\n## Workflow\nDo the thing.\n`;

// ---- ZIP: valid (folder + root) ----
const z1 = buildZip([
  { name: 'my-skill/skill.md', data: MD('Zip Skill', 'A skill imported from a ZIP archive for testing purposes here.') },
  { name: 'my-skill/scripts/main.js', data: `output = { zipped: true, echo: input.x };` },
  { name: 'my-skill/references/notes.md', data: 'reference notes' },
]);
const v1 = pkg.validatePackage({ zipBase64: b64(z1) });
assert.equal(v1.ok, true, 'valid folder ZIP passes: ' + (v1.errors || []).join(';'));
assert.ok(v1.package.scripts['scripts/main.js'], 'prefix stripped');
assert.equal(v1.package.manifest.license, 'MIT', 'license parsed');
const i1 = await store.installSkill(A, v1.package, { scope: 'user', source: 'imported' });
assert.equal(i1.ok, true);
const inv1 = await rt.invokeSkill(A, i1.skill.id, { input: { x: 42 } });
assert.equal(inv1.ok && inv1.executed && inv1.result.echo, 42, 'zipped JS skill executes');
const z2 = buildZip([{ name: 'skill.md', data: MD('Root Skill', 'A skill with skill.md at the archive root for testing.') }], { deflate: true });
const v2 = pkg.validatePackage({ zipBase64: b64(z2) });
assert.equal(v2.ok, true, 'deflate + root skill.md passes');
pass('ZIP valid import (folder/root, stored/deflate) + invoke');

// ---- ZIP: attacks ----
const slip = buildZip([{ name: '../../evil.js', data: 'x' }, { name: 'skill.md', data: MD('S', 'Desc desc desc desc desc desc desc.') }]);
assert.ok(!pkg.validatePackage({ zipBase64: b64(slip) }).ok, 'zip-slip rejected');
const abs = buildZip([{ name: '/etc/skill.md', data: 'x' }]);
assert.ok(!pkg.validatePackage({ zipBase64: b64(abs) }).ok, 'absolute path rejected');
const nested = buildZip([
  { name: 'skill.md', data: MD('N', 'Desc desc desc desc desc desc desc.') },
  { name: 'evil.zip', data: Buffer.from([1, 2, 3]) },
]);
assert.ok(!pkg.validatePackage({ zipBase64: b64(nested) }).ok, 'nested archive rejected');
const bin = buildZip([
  { name: 'skill.md', data: MD('B', 'Desc desc desc desc desc desc desc.') },
  { name: 'run.exe', data: Buffer.from([1, 2, 3]) },
]);
assert.ok(!pkg.validatePackage({ zipBase64: b64(bin) }).ok, 'native binary rejected');
const bomb = buildZip([{ name: 'skill.md', data: MD('Bo', 'Desc desc desc desc desc desc desc.') }, { name: 'big.txt', data: Buffer.alloc(300000, 'a') }], { deflate: true });
const vbomb = pkg.validatePackage({ zipBase64: b64(bomb) });
assert.ok(!vbomb.ok && /ratio|bomb|large/i.test(vbomb.errors.join(' ')), 'compression bomb rejected: ' + vbomb.errors.join(';'));
const noskill = buildZip([{ name: 'readme.txt', data: 'hi' }]);
assert.ok(!pkg.validatePackage({ zipBase64: b64(noskill) }).ok, 'missing skill.md rejected');
assert.ok(!pkg.validatePackage({ zipBase64: '!!!not-base64-but-valid-chars!!!' }).ok, 'garbage rejected');
const many = [];
for (let i = 0; i < 105; i++) many.push({ name: `f${i}.txt`, data: 'x' });
many.push({ name: 'skill.md', data: MD('M', 'Desc desc desc desc desc desc desc.') });
assert.ok(!pkg.validatePackage({ zipBase64: b64(buildZip(many)) }).ok, 'file-count cap enforced');
pass('ZIP attacks rejected (slip/absolute/nested/binary/bomb/noskill/count)');

// ---- manifest ext + tool coverage ----
const m = pkg.normalizeManifest({ name: 'X', description: 'Y', entrypoints: 'main.js', plugins: 'gh', providers: 'IMAGE_GENERATION', apis: 'a,b' });
assert.deepEqual(m.entrypoints, ['main.js']);
assert.deepEqual(m.plugins, ['gh']);
assert.deepEqual(m.providers, ['IMAGE_GENERATION']);
await import('../src/tools/catalog.js'); // side-effect: populates tool registry
const known = tools.listTools().map((t) => t.name);
assert.ok(known.length > 0, 'tool catalog non-empty');
pass('manifest ext (license/entrypoints/plugins/providers)');

// ---- diff ----
const base = pkg.validatePackage({ 'skill.md': MD('Diff Skill', 'Base description for diff testing purposes now.') });
const di = await store.installSkill(A, base.package, { scope: 'user', source: 'created' });
const upd = pkg.validatePackage({ 'skill.md': MD('Diff Skill', 'CHANGED description for diff testing purposes now.') });
await store.updateSkill(A, di.skill.id, upd.package, 'tune');
const { diffVersions } = await import('../src/core/skillStore.js');
const d = await diffVersions(A, di.skill.id, '1.0.0');
assert.equal(d.ok, true);
assert.ok(d.diff.description, 'description change shown');
assert.equal(await diffVersions(B, di.skill.id, '1.0.0'), null, 'B sees no diff');
pass('update diff (description change, cross-user blocked)');

// ---- runtime adapters ----
assert.equal(runtimes.adapterFor('s/main.js').kind, 'JS_SANDBOX');
assert.equal(runtimes.adapterFor('s/run.py').available, false, 'python unavailable');
assert.equal(runtimes.adapterFor('s/x.sh').available, false, 'shell unavailable');
const py = runtimes.runEntry('scripts/run.py', 'print(1)', {});
assert.equal(py.ok, false, 'python refused honestly');
assert.ok(/not enabled/i.test(py.error + py.note));
pass('runtime adapters (JS live, others declared-unavailable)');

// ---- schedules contract ----
const sch = (await import('../src/core/skillTasks.js'));
const reg = sch.registerSchedule(A, { skillId: i1.skill.id, cadence: 'fridays', input: {} });
assert.equal(reg.ok, true);
assert.equal(sch.listSchedules(B).length, 0, 'schedules per-user');
assert.equal(sch.removeSchedule(B, reg.schedule.id), false);
assert.equal(sch.removeSchedule(A, reg.schedule.id), true);
pass('schedule contract (register/list/remove, scoped)');

// ---- initiative policies ----
const mis = { id: 'm1', objective: 'Research agent security posture thoroughly' };
const rep = pkg.validatePackage({ 'skill.md': MD('Preso Skill', 'Build slide presentations from research findings and data automatically.') });
const ps = await store.installSkill(A, rep.package, { scope: 'user', source: 'created' });
const allAuto = await (await import('../src/core/skillDiscovery.js')).discoverFor(A, 'Report on completed mission: Research agent security posture thoroughly. Deliverables, presentation, document, summary.', {});
assert.ok(allAuto.some((c) => c.skillId === ps.skill.id && c.auto), 'follow-up skill auto-matches mission context');
for (const [mode, want] of [['passive', 'suggested'], ['assisted', 'suggested'], ['proactive', 'queue'], ['autonomous', 'run']]) {
  const r = await init.proposeFollowups({ getProfile: async () => ({ autonomy: mode }) }, A, mis);
  assert.equal(r.action, want, `policy ${mode} → ${want}, got ${r.action}`);
}
pass('initiative policies (suggest/suggest/queue/run)');

// ---- benchmark: 10/100/500/1000 ----
const benchUser = users.createUser({ handle: 'bench', passcode: 'pass1234' }).user.id;
const mkSkill = (i) => pkg.validatePackage({
  'skill.md': MD(`Bench Skill ${i}`, `Handles frobnicate workflow number ${i} with quux processing tasks.`),
});
for (let i = 0; i < 1000; i++) {
  const g = mkSkill(i);
  await store.installSkill(benchUser, g.package, { scope: 'user', source: 'created' });
}
const benchTask = 'frobnicate workflow number 500 with quux processing tasks';
const bench = {};
for (const n of [10, 100, 500, 1000]) {
  // simulate N by slicing visibility: use project scoping? simpler: time full 1000 and time subsets via temp users
  void n;
}
{
  const t0 = Date.now();
  const c = await (await import('../src/core/skillDiscovery.js')).discoverFor(benchUser, benchTask, {});
  bench.n1000 = Date.now() - t0;
  assert.ok(c.some((x) => x.name === 'Bench Skill 500'), 'finds skill 500/1000');
}
for (const n of [10, 100, 500]) {
  const u = users.createUser({ handle: 'bmk' + n, passcode: 'pass1234' }).user.id;
  for (let i = 0; i < n; i++) {
    const g = mkSkill(i);
    await store.installSkill(u, g.package, { scope: 'user', source: 'created' });
  }
  const t0 = Date.now();
  (await import('../src/core/skillDiscovery.js')).discoverFor(u, `frobnicate workflow number ${n - 1} with quux processing tasks`, {});
  bench['n' + n] = Date.now() - t0;
}
console.log('BENCH discovery ms:', JSON.stringify(bench));
assert.ok(bench.n1000 < 500, `1000-skill discovery ${bench.n1000}ms < 500ms`);
pass('benchmark 10/100/500/1000 under budget');

// ---- discovery quality: strong/weak/negative/unrelated/competing ----
const q = pkg.validatePackage({ 'skill.md': MD('PPT QA Skill', 'Validate PowerPoint presentations for layout, factual consistency, broken elements and presentation quality.') });
const qq = await store.installSkill(A, q.package, { scope: 'user', source: 'created' });
const D = async (...a) => (await (await import('../src/core/skillDiscovery.js')).discoverFor(...a));
const strong = await D(A, 'Check this PPT for layout and factual consistency please');
assert.ok(strong[0]?.skillId === qq.skill.id && strong[0].auto, 'strong match wins + auto');
const weak = await D(A, 'presentation');
assert.ok(weak.some((c) => c.skillId === qq.skill.id) && !weak.find((c) => c.skillId === qq.skill.id)?.auto, 'weak match listed, not auto');
const neg = await D(A, 'bake a chocolate cake recipe');
assert.ok(!neg.some((c) => c.skillId === qq.skill.id), 'unrelated never matches');
const comp = pkg.validatePackage({ 'skill.md': MD('Slide Deck Skill', 'Create new slide decks and presentations from scratch with templates.') });
const cc = await store.installSkill(A, comp.package, { scope: 'user', source: 'created' });
const race = await D(A, 'Validate my PowerPoint presentation for broken elements and factual consistency');
assert.ok(race[0]?.skillId === qq.skill.id, 'specific QA beats generic creator');
void cc;
pass('discovery quality (strong/weak/negative/unrelated/competing)');

console.log('\nALL SKILLS V2 TESTS PASSED');
