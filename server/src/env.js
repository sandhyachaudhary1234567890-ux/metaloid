// THE environment initialisation path. Exactly one, and it runs first.
//
// Why this module exists
// ----------------------
// Several modules read `process.env` while they are being *evaluated*, not
// while they are running:
//
//     server/src/auth.js        SUPABASE_JWKS_URL / SUPABASE_JWT_SECRET /
//                               SUPABASE_JWT_PUBLIC_KEY / _ISSUER / _AUDIENCE
//     server/src/openrouter.js  OPENROUTER_BASE / OPENROUTER_MODEL
//     server/src/core/*.js      METALOID_DATA_DIR (and friends)
//
// ES module semantics hoist and evaluate every `import` before the importing
// module's own body runs. The loader used to live *inside* index.js's body, so
// it executed AFTER auth.js had already captured an empty environment. The
// visible result on a correctly-configured self-hosted deployment was
// `/api/health` reporting `auth: { configured: false }`, and — because
// `localOpenMode()` gates the development fallback on `authConfigured()` — a
// loopback caller could still be handed the local owner identity on a gateway
// whose JWT secret was in fact configured. The configuration was present and
// simply ignored.
//
// The fix is ordering, not more loaders: this module is imported *first* by
// every real entry point, so by the time auth.js/openrouter.js/core/* are
// evaluated the environment is already populated. That repairs the whole class
// of bug at once rather than one variable at a time.
//
// Contract
// --------
//   * No imports from application code. This module must never be able to
//     participate in an import cycle, or the ordering guarantee it exists to
//     provide would be circular.
//   * Ambient environment always wins. A value already in `process.env` is
//     never overwritten by the file — which is what makes hosted platforms
//     (Vercel injects real env vars) authoritative over any file that happens
//     to be lying around.
//   * `METALOID_NO_DOTENV` disables file loading entirely. The test suite sets
//     it so a developer's real `server/.env` cannot change what is under test.
//   * Missing file is not an error. Production has no `.env`; that is normal.
//   * Idempotent. Import it as many times as you like.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Default location: `server/.env`, next to this file's parent. */
export const DEFAULT_ENV_PATH = path.join(HERE, '..', '.env');

/** Set once the file has been consulted, so repeat calls are free. */
let consulted = false;

/**
 * Parse one `KEY=value` line. Deliberately narrow: this is not a dotenv
 * reimplementation, it accepts exactly the shape the repository writes.
 * @returns {[string, string] | null}
 */
function parseLine(line) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (!m) return null;
  let value = m[2].trim();
  // Strip one layer of matching quotes, so `KEY="a b"` yields `a b`.
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1);
  }
  return [m[1], value];
}

/**
 * Load a dotenv file into `process.env` without overriding what is already
 * set. Safe to call with a path that does not exist.
 *
 * @param {string} [file] path to the env file
 * @returns {{ loaded: boolean, applied: string[] }} what happened, for tests
 */
export function loadEnvFile(file = DEFAULT_ENV_PATH) {
  const applied = [];
  if (process.env.METALOID_NO_DOTENV) return { loaded: false, applied };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { loaded: false, applied }; // absent is a legitimate state
  }
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return { loaded: true, applied };
}

/**
 * Consult the environment file once. Called at the bottom of this module, so
 * merely importing it performs initialisation — that is the whole point.
 */
export function initEnv(file = DEFAULT_ENV_PATH) {
  if (consulted) return { loaded: false, applied: [] };
  consulted = true;
  return loadEnvFile(file);
}

// Side effect on import: the ordering guarantee every other module relies on.
export const envStatus = initEnv();
