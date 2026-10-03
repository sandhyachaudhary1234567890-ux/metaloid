// Preflight must actually block, and must not cry wolf.
//
// A checker that never fails is worse than none, so each blocker is asserted
// against a configuration that is wrong in exactly that one way. And a checker
// that fails on a correct configuration gets ignored, so the complete case is
// asserted to pass with no blockers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, parseEnvFile } from '../tools/preflight.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PRODUCTION = {
  METALOID_MODE: 'production',
  SUPABASE_DB: 'supabase',
  SUPABASE_DB_POOL_URL: 'postgresql://postgres:pw@db.example.supabase.co:6543/postgres',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder-value',
  SUPABASE_JWKS_URL: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
  METALOID_ENCRYPTION_KEYS: 'k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  METALOID_ENCRYPTION_ACTIVE: 'k1',
  OPENROUTER_API_KEY: 'sk-or-v1-' + 'a'.repeat(32),
  ALLOW_ORIGINS: 'https://metaloid.vercel.app',
};

const without = (...keys) => {
  const copy = { ...PRODUCTION };
  for (const k of keys) delete copy[k];
  return copy;
};

test('a complete production configuration passes with no blockers or warnings', () => {
  const r = evaluate(PRODUCTION);
  assert.equal(r.ok, true, JSON.stringify(r.blockers.map((b) => b.detail), null, 1));
  assert.equal(r.production, true);
  assert.equal(r.driver, 'supabase');
  assert.equal(r.authMode, 'jwks');
  assert.deepEqual(r.warnings, [], 'a complete config should not warn');
});

test('no token verifier is a blocker, and names the three accepted variables', () => {
  const r = evaluate(without('SUPABASE_JWKS_URL', 'SUPABASE_JWT_PUBLIC_KEY', 'SUPABASE_JWT_SECRET'));
  assert.equal(r.ok, false);
  assert.equal(r.authMode, 'unconfigured');
  const detail = r.blockers.find((b) => b.name === 'token verification')?.detail || '';
  for (const name of ['SUPABASE_JWKS_URL', 'SUPABASE_JWT_PUBLIC_KEY', 'SUPABASE_JWT_SECRET']) {
    assert.ok(detail.includes(name), `the message should name ${name}`);
  }
});

test('a placeholder counts as missing, not as configured', () => {
  // The failure mode this prevents: a copied .env.example deployed as-is,
  // where the variable exists but nothing usable is in it. Both verifier
  // variables are placeholders here, so there is nothing to verify with.
  const r = evaluate({
    ...without('SUPABASE_JWKS_URL', 'SUPABASE_JWT_PUBLIC_KEY'),
    SUPABASE_JWT_SECRET: 'REPLACE_ME_JWT_SECRET',
    METALOID_ENCRYPTION_KEYS: 'k1:REPLACE_WITH_32_BYTES_BASE64',
  });
  assert.equal(r.ok, false);
  assert.equal(r.authMode, 'unconfigured', 'a placeholder must not be treated as a verifier');
  assert.ok(r.blockers.some((b) => b.name === 'provider-key encryption'));
});

test('production without the durable driver switch is a blocker', () => {
  const r = evaluate(without('SUPABASE_DB', 'SUPABASE_DB_POOL_URL'));
  assert.equal(r.ok, false);
  assert.equal(r.driver, 'local');
  const detail = r.blockers.find((b) => b.name === 'durable storage')?.detail || '';
  assert.ok(/lose|loses|local JSON store/i.test(detail), 'it must say the consequence, not just the setting');
});

test('the switch without a connection string is still a blocker', () => {
  const r = evaluate(without('SUPABASE_DB_POOL_URL'));
  assert.equal(r.ok, false);
  assert.equal(r.driver, 'local');
  assert.ok(r.blockers.some((b) => /SUPABASE_DB_POOL_URL/.test(b.detail)));
});

test('a serverless host is production even when nothing says so', () => {
  // The dangerous case: a deployment with no METALOID_MODE, where "not
  // explicitly production" would otherwise excuse a local data store.
  const r = evaluate({ ...without('METALOID_MODE', 'SUPABASE_DB', 'SUPABASE_DB_POOL_URL'), VERCEL: '1' });
  assert.equal(r.production, true, 'VERCEL must imply production');
  assert.equal(r.ok, false);
  assert.ok(/tmp/.test(r.blockers.find((b) => b.name === 'durable storage')?.detail || ''),
    'on a serverless host the message should say the store is /tmp');
});

test('demo escape hatches are blockers in production and fine outside it', () => {
  const demo = { ...PRODUCTION, METALOID_ALLOW_ANONYMOUS: 'true', ALLOW_ORIGINS: '*' };
  const prod = evaluate(demo);
  assert.equal(prod.ok, false);
  assert.ok(prod.blockers.some((b) => b.name === 'no anonymous access'));
  assert.ok(prod.blockers.some((b) => b.name === 'origin allow-list'));

  // The same settings on a developer machine are a note, not a failure.
  const { METALOID_MODE, ...dev } = demo;
  const local = evaluate(dev);
  assert.equal(local.production, false);
  assert.equal(local.ok, true, 'development must not be blocked by development settings');
  assert.ok(local.checks.some((c) => c.name === 'local demo mode'));
});

test('--production forces the strict verdict on an unlabelled config', () => {
  const dev = { SUPABASE_DB: 'supabase', SUPABASE_DB_POOL_URL: 'postgresql://x/y' };
  assert.equal(evaluate(dev).production, false);
  const forced = evaluate(dev, { requireProduction: true });
  assert.equal(forced.production, true);
  assert.equal(forced.ok, false, 'no verifier, no encryption, no origins — must not pass as production');
});

test('a missing provider key warns but does not block', () => {
  const r = evaluate(without('OPENROUTER_API_KEY'));
  assert.equal(r.ok, true, 'no provider key means degraded chat, not a broken deployment');
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].name, 'model provider');
});

test('missing storage credentials warn, because uploads would half-work', () => {
  const r = evaluate(without('SUPABASE_SERVICE_ROLE_KEY'));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.name === 'object storage' && /storage_unavailable/.test(w.detail)));
});

test('the env-file reader handles comments, quotes and equals signs in values', () => {
  const parsed = parseEnvFile([
    '# a comment',
    'PLAIN=value',
    'QUOTED="a value with spaces"',
    "SINGLE='x'",
    'WITH_EQUALS=postgresql://u:p@h:6543/postgres?sslmode=require',
    'EMPTY=',
    '',
  ].join('\n'));
  assert.equal(parsed.PLAIN, 'value');
  assert.equal(parsed.QUOTED, 'a value with spaces');
  assert.equal(parsed.SINGLE, 'x');
  assert.equal(parsed.WITH_EQUALS, 'postgresql://u:p@h:6543/postgres?sslmode=require');
  assert.equal(parsed.EMPTY, '');
});

test('preflight never prints a secret', async () => {
  const { spawnSync } = await import('node:child_process');
  const secret = 'supersecretvalue-should-never-be-printed';
  const res = spawnSync(process.execPath, [path.join(HERE, '..', 'tools', 'preflight.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_JWT_SECRET: secret, SUPABASE_DB: 'supabase' },
  });
  assert.ok(!String(res.stdout).includes(secret), 'a secret leaked into preflight output');
  assert.ok(!String(res.stderr).includes(secret), 'a secret leaked into preflight errors');
});
