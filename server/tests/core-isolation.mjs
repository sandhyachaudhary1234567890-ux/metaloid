// Core-level multi-user isolation tests. Self-isolating: uses a fresh temp
// data dir unless METALOID_DATA_DIR is set (never touches real data).
// Run: node server/tests/core-isolation.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.METALOID_DATA_DIR) {
  process.env.METALOID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'metaloid-core-'));
}

const pass = (n) => console.log('PASS', n);

const users = await import('../src/core/users.js');
const memory = await import('../src/core/memory.js');
const missions = await import('../src/core/missions.js');
const world = await import('../src/core/world.js');
const osint = await import('../src/osint.js');
const perms = await import('../src/core/permissions.js');
const profiles = await import('../src/core/profiles.js');
const ent = await import('../src/core/entitlements.js');
const ws = await import('../src/core/workspaces.js');

// ---- users: A (admin, first), B, C ----
const a = users.createUser({ handle: 'alice', displayName: 'Alice', passcode: 'alice1234' });
assert.equal(a.ok, true); assert.equal(a.user.role, 'admin');
const b = users.createUser({ handle: 'bob', displayName: 'Bob', passcode: 'bob1234' });
assert.equal(b.ok, true); assert.equal(b.user.role, 'user');
const dup = users.createUser({ handle: 'alice', passcode: 'x' });
assert.equal(dup.ok, false);
const bad = users.createUser({ handle: 'ab', passcode: 'x' });
assert.equal(bad.ok, false);
assert.equal(users.verifyUser('alice', 'wrong').ok, false);
assert.equal(users.verifyUser('alice', 'alice1234').ok, true);
const A = a.user.id, B = b.user.id;
pass('signup/roles/validation');

// ---- sessions ----
const sa = users.createSession(A, { deviceName: 'test' });
const sb = users.createSession(B, {});
assert.ok(users.validateAccess(sa.access)?.userId === A);
assert.equal(users.validateAccess('mta_bogus'), null);
const r1 = users.refreshSession(sa.refresh);
assert.ok(r1 && r1.access !== sa.access);
assert.equal(users.refreshSession(sa.refresh), null, 'old refresh must die on rotation');
assert.ok(users.validateAccess(r1.access)?.sessionId === sa.session.id, 'same session after rotation');
assert.equal(users.revokeSession('ses-nope', A), false);
assert.equal(users.revokeSession(sa.session.id, B), false, 'B cannot revoke A session');
assert.equal(users.revokeSession(sa.session.id, A), true);
assert.equal(users.validateAccess(r1.access), null, 'revoked access dead');
pass('sessions: validate/rotation/revoke');

// ---- memory isolation ----
const ma = memory.remember({ userId: A, content: 'Alice secret plan' });
assert.equal(ma.ok, true);
assert.deepEqual(memory.recall(B, {}), [], 'B sees nothing of A');
assert.equal(memory.recall(A, {}).length, 1);
assert.equal(memory.forget(B, ma.record.id).ok, false, 'B cannot delete A memory');
assert.equal(memory.updateMemory(B, ma.record.id, { content: 'hijack' }).ok, false);
const up = memory.updateMemory(A, ma.record.id, { content: 'Alice updated plan' });
assert.equal(up.ok && up.record.content, 'Alice updated plan');
const mb = memory.remember({ userId: B, content: 'Bob note' });
assert.equal(memory.recall(B, {}).length, 1);
assert.equal(memory.stats(A).total, 1);
pass('memory isolation + user control');

// ---- missions isolation ----
const mA = missions.createMission({ userId: A, objective: 'Research agent security', tasks: [] });
assert.ok(mA.userId === A);
assert.equal(missions.getMission(B, mA.id), null, 'B cannot open A mission');
assert.deepEqual(missions.listMissions(B), [], 'B list empty');
assert.equal(missions.pauseMission(B, mA.id), null);
assert.equal(missions.listMissions(A).length, 1);
await missions.runMission(A, mA.id, { userId: A });
const done = missions.getMission(A, mA.id);
assert.ok(['COMPLETED', 'BLOCKED'].includes(done.status), 'mission ran, got ' + done.status);
pass('missions isolation + run');

// ---- world isolation ----
const ea = world.upsertEntity({ userId: A, type: 'project', name: 'Alice Project' });
assert.equal(world.findEntities(B, 'alice').length, 0);
assert.equal(world.findEntities(A, 'alice').length, 1);
const eb = world.upsertEntity({ userId: B, type: 'project', name: 'Alice Project' });
assert.ok(eb.id !== ea.id, 'same name, separate entities per user');
assert.equal(world.relate(B, ea.id, eb.id, 'x').ok, false, 'B cannot link A entity');
assert.ok(world.relate(A, ea.id, ea.id, 'self').ok);
assert.deepEqual(world.neighbors(B, ea.id), { entities: [], relations: [] });
pass('world isolation');

// ---- osint isolation ----
const ja = osint.createInvestigation('example.com', 'domain', A);
assert.equal(osint.getInvestigationFor(B, ja.id), null);
assert.ok(osint.getInvestigationFor(A, ja.id));
assert.deepEqual(osint.listInvestigations(B), []);
pass('osint isolation');

// ---- approvals isolation ----
const gate = perms.authorize({ name: 'test.tool', risk: 'irreversible' }, {}, {}, A);
assert.ok(gate.approvalId);
assert.deepEqual(perms.pendingApprovals(B), []);
assert.equal(perms.pendingApprovals(A).length, 1);
assert.equal(perms.grantApproval(gate.approvalId, true, 'user', B), null, 'B cannot decide A approval');
assert.ok(perms.grantApproval(gate.approvalId, true, 'user', A));
pass('approvals isolation');

// ---- profiles: validation, no silent upgrades ----
const p0 = profiles.getProfile(A);
assert.equal(p0.autonomy, 'assisted');
profiles.updateProfile(A, { autonomy: 'autonomous', tone: 'warm', evil: 'x', language: 'xx' });
const p1 = profiles.getProfile(A);
assert.equal(p1.autonomy, 'autonomous');
assert.equal(p1.tone, 'warm');
assert.equal(p1.evil, undefined, 'unknown keys dropped');
assert.equal(p1.language, 'auto', 'invalid values dropped');
assert.ok(profiles.personalizationBlock(A).includes('AUTONOMOUS'));
pass('profiles validation + personalization');

// ---- entitlements + budgets ----
assert.equal(ent.getPlan(A), 'free');
assert.equal(ent.can(A, 'chat'), true);
assert.equal(ent.can(A, 'teleport'), false);
for (let i = 0; i < 100; i++) ent.recordUsage(B, 'chat');
const over = ent.checkBudget(B, 'chat');
assert.equal(over.ok, false, 'free daily chat budget enforced');
assert.ok(ent.checkBudget(A, 'chat').ok);
const u = ent.usageSummary(A);
assert.equal(u.plan, 'free');
assert.equal(u.chat.limit, 100);
pass('entitlements + budgets');

// ---- workspaces + devices ----
const wA = ws.createWorkspace(A, { name: 'Research' });
assert.equal(wA.ok, true);
assert.equal(ws.getWorkspace(B, wA.workspace.id), null);
assert.deepEqual(ws.listWorkspaces(B), []);
const pair = ws.requestPairing(A, { deviceName: 'phone' });
assert.ok(/^\d{6}$/.test(pair.code));
const conf = ws.confirmPairing(A, pair.code, {});
assert.equal(conf.ok, true);
assert.equal(ws.authorizeDevice(B, conf.device.id, 'x').ok, false, 'B cannot use A device');
assert.ok(ws.authorizeDevice(A, conf.device.id, 'x').ok);
assert.equal(ws.revokeDevice(B, conf.device.id), false);
assert.equal(ws.revokeDevice(A, conf.device.id), true);
pass('workspaces + devices');

// ---- delete cascade ----
const del = (() => {
  memory.deleteUserMemories(B);
  missions.deleteUserMissions(B);
  world.deleteUserWorld(B);
  osint.deleteUserInvestigations(B);
  perms.deleteUserApprovals(B);
  ws.deleteUserWorkspaces(B);
  ws.deleteUserDevices(B);
  ent.deleteUsage(B);
  profiles.deleteProfile(B);
  return users.deleteUserCascade(B);
})();
assert.equal(del, true);
assert.deepEqual(memory.recall(A, {}).length, 1, 'A data survives B deletion');
assert.equal(users.getUser(B), null);
pass('delete cascade, A intact');

console.log('\nALL CORE TESTS PASSED');
