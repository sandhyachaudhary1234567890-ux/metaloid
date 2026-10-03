#!/usr/bin/env node
// Preflight: will this configuration actually work, and is it actually
// production?
//
// Every failure this catches has already happened once in this repository, and
// each was invisible until something broke at runtime:
//
//   * the data driver silently defaulting to a local JSON store, which on a
//     serverless host is /tmp — the app looks healthy and loses data
//   * no token verifier configured, so "auth is configured" was decided by
//     hand-written env-var lists in two places that disagreed
//   * encryption missing, so provider keys could be accepted and never stored
//   * a demo escape hatch (anonymous owner identity, `ALLOW_ORIGINS=*`) left
//     enabled on a deployment that is supposed to be real
//
// It runs offline: no network, no database. It answers "is this configuration
// coherent", not "is the remote healthy" — `/api/health` answers the second.
//
//   node server/tools/preflight.mjs                 # reads the environment
//   node server/tools/preflight.mjs --env server/.env
//   node server/tools/preflight.mjs --production    # fail unless it is real
//
// Exit codes: 0 = usable, 1 = at least one blocker (warnings do not fail).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Minimal .env reader. Values may be quoted; later lines win. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const present = (v) => typeof v === 'string' && v.trim().length > 0;
const PLACEHOLDER = /REPLACE|CHANGE_ME|YOUR[-_]|your-project-ref|xxxx|<.+>/i;
const real = (v) => present(v) && !PLACEHOLDER.test(v);

/**
 * Classify a configuration. Pure: takes an env object, returns a report.
 *
 * `production` is true when asked for explicitly, or when the process is
 * running on a serverless host — in both cases a demo escape hatch is a
 * blocker rather than a convenience.
 */
export function evaluate(env = {}, { requireProduction = false } = {}) {
  const checks = [];
  const add = (level, name, ok, detail) => checks.push({ level, name, ok, detail });

  const onVercel = present(env.VERCEL) || present(env.VERCEL_ENV);
  const declared = (env.METALOID_MODE || '').toLowerCase();
  const production = declared === 'production' || onVercel || requireProduction;

  // ── identity ──────────────────────────────────────────────────────────
  // auth.js verifies with exactly one of these. Nothing else counts.
  const verifiers = [
    ['SUPABASE_JWKS_URL', 'jwks'],
    ['SUPABASE_JWT_PUBLIC_KEY', 'public-key'],
    ['SUPABASE_JWT_SECRET', 'hs256'],
  ].filter(([k]) => real(env[k]));
  const authMode = verifiers.length ? verifiers[0][1] : 'unconfigured';
  add(
    'blocker', 'token verification',
    verifiers.length > 0,
    verifiers.length
      ? `mode "${authMode}" via ${verifiers[0][0]}`
      : 'none of SUPABASE_JWKS_URL / SUPABASE_JWT_PUBLIC_KEY / SUPABASE_JWT_SECRET is set — every protected route returns 503 auth_unconfigured'
  );
  if (verifiers.length > 1) {
    add('info', 'token verification', true, `${verifiers.length} verifiers set; ${verifiers[0][0]} wins`);
  }

  // ── durable storage ───────────────────────────────────────────────────
  // This is the one that loses data quietly, so it is a blocker in production.
  // Both halves are required, and the message must name the half that is
  // actually missing — "set SUPABASE_DB" is useless advice to someone who
  // already set it and left the connection string blank.
  const dbSwitch = (env.SUPABASE_DB || '').toLowerCase() === 'supabase';
  const poolUrl = real(env.SUPABASE_DB_POOL_URL);
  const durable = dbSwitch && poolUrl;
  const halfMissing = !dbSwitch && !poolUrl
    ? 'SUPABASE_DB=supabase and SUPABASE_DB_POOL_URL are both unset'
    : !dbSwitch
      ? `SUPABASE_DB is "${env.SUPABASE_DB || ''}", not "supabase" — SUPABASE_DB_POOL_URL alone changes nothing`
      : 'SUPABASE_DB=supabase but SUPABASE_DB_POOL_URL is empty';
  add(
    production ? 'blocker' : 'info', 'durable storage',
    production ? durable : true,
    durable
      ? 'Postgres driver selected with a pooler URL'
      : production
        ? `${halfMissing} — the gateway silently falls back to the local JSON store${onVercel ? ', which on this host is /tmp: wiped every time the instance recycles' : ''}`
        : `${halfMissing} — local store (fine outside production)`
  );

  // ── secrets ───────────────────────────────────────────────────────────
  const encKeys = real(env.METALOID_ENCRYPTION_KEYS);
  add(
    'blocker', 'provider-key encryption',
    encKeys,
    encKeys
      ? `keyring configured${env.METALOID_ENCRYPTION_ACTIVE ? `, active=${env.METALOID_ENCRYPTION_ACTIVE}` : ' (first key is active)'}`
      : 'METALOID_ENCRYPTION_KEYS is unset — saving a provider key is refused with 503 encryption_unconfigured'
  );

  const storageCreds = real(env.SUPABASE_URL) && real(env.SUPABASE_SERVICE_ROLE_KEY);
  add(
    'warning', 'object storage',
    storageCreds,
    storageCreds
      ? 'signed URLs and object deletion are available'
      : 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — uploads succeed but downloads report storage_unavailable'
  );

  // ── the model provider ────────────────────────────────────────────────
  const provider = real(env.OPENROUTER_API_KEY) || (String(env.NVIDIA_ENABLED) === 'true' && real(env.NVIDIA_API_KEY));
  add(
    'warning', 'model provider',
    provider,
    provider
      ? 'a provider key is present'
      : 'no provider key — /api/health will report ai:false and chat will answer with no_provider'
  );

  // ── demo escape hatches ───────────────────────────────────────────────
  // "no demo sandbox" is a property of the configuration, not a promise.
  if (production) {
    const anonymous = String(env.METALOID_ALLOW_ANONYMOUS || '').toLowerCase() === 'true' || declared === 'showcase';
    add(
      'blocker', 'no anonymous access',
      !anonymous,
      anonymous
        ? 'METALOID_ALLOW_ANONYMOUS / METALOID_MODE=showcase hands same-host callers the local owner identity — an anonymous route to the platform provider key'
        : 'anonymous owner identity is off'
    );

    const origins = String(env.ALLOW_ORIGINS || '');
    const wildcard = origins.split(',').map((s) => s.trim()).includes('*');
    add(
      'blocker', 'origin allow-list',
      present(origins) && !wildcard,
      wildcard
        ? 'ALLOW_ORIGINS contains "*" — any site can call this backend with a user\'s browser'
        : present(origins) ? `restricted to ${origins.split(',').length} origin(s)` : 'ALLOW_ORIGINS is empty; a browser origin will be rejected'
    );
  } else {
    const anonymous = String(env.METALOID_ALLOW_ANONYMOUS || '').toLowerCase() === 'true' || declared === 'showcase';
    if (anonymous) {
      add('info', 'local demo mode', true, 'anonymous owner identity is enabled — development only, never a deployment');
    }
  }

  const blockers = checks.filter((c) => !c.ok && c.level === 'blocker');
  const warnings = checks.filter((c) => !c.ok && c.level === 'warning');

  return {
    ok: blockers.length === 0,
    production,
    driver: durable ? 'supabase' : 'local',
    authMode,
    checks,
    blockers,
    warnings,
  };
}

/**
 * The marker says what the *verdict* is, not how severe the check could be.
 * Printing the level symbol for a check that passed made a healthy config read
 * as a list of failures — a report nobody trusts is a report nobody reads.
 */
const MARK = (c) => (c.ok ? '✓' : c.level === 'blocker' ? '✖' : c.level === 'warning' ? '!' : '·');

function main() {
  const args = process.argv.slice(2);
  const envIdx = args.indexOf('--env');
  const requireProduction = args.includes('--production');

  let env = { ...process.env };
  let source = 'the ambient environment';
  // With no --env, check `server/.env` if it is there. The ambient environment
  // on a developer machine holds none of these variables, so defaulting to it
  // would report "nothing is configured" on a machine that is fully
  // configured — the least useful possible answer from a tool whose whole job
  // is to tell you what is missing.
  const defaultFile = path.join(process.cwd(), 'server', '.env');
  const fallbackFile = path.join(process.cwd(), '.env');
  const chosen = args[envIdx + 1]
    || (fs.existsSync(defaultFile) ? defaultFile : fs.existsSync(fallbackFile) ? fallbackFile : null);
  if (chosen) {
    const file = path.resolve(process.cwd(), chosen);
    if (!fs.existsSync(file)) {
      console.error(`preflight: ${file} does not exist`);
      process.exit(1);
    }
    // Ambient wins over the file, but *only* where it actually holds a value:
    // an exported empty string means "unset" to everyone except a shell, and
    // letting one blank out the file's value would make `X=... preflight
    // --env f` silently test the wrong configuration. This is the ordering
    // dotenv users expect, and it keeps one-off "what if this were set"
    // probes from requiring an edit to the file.
    const fromFile = parseEnvFile(fs.readFileSync(file, 'utf8'));
    const fromEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => present(v)));
    env = { ...fromFile, ...fromEnv };
    source = `${path.relative(process.cwd(), file) || file} (+ ambient overrides)`;
  }

  const report = evaluate(env, { requireProduction });

  console.log(`\nMetaIoid preflight — ${report.production ? 'PRODUCTION' : 'development'} configuration`);
  console.log(`  config      : ${source}`);
  console.log(`  data driver : ${report.driver}`);
  console.log(`  auth mode   : ${report.authMode}\n`);
  for (const c of report.checks) {
    console.log(`  ${MARK(c)} ${c.name.padEnd(22)} ${c.detail}`);
  }

  if (report.blockers.length) {
    console.log(`\n${report.blockers.length} blocker(s) — this configuration must not serve production.`);
    if (report.production) {
      console.log('A deployment in this state either loses data, refuses every request, or is open to the world.');
    }
    process.exit(1);
  }
  console.log(
    report.warnings.length
      ? `\nUsable, with ${report.warnings.length} warning(s) above.`
      : '\nUsable: no blockers, no warnings.'
  );
}

// Only run the CLI when invoked directly; the test imports `evaluate`.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
