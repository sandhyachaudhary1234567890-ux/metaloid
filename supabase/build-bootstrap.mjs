#!/usr/bin/env node
// Build `supabase/bootstrap.sql` from `supabase/migrations/`.
//
// Why this exists: the migrations are the only source of truth (a
// hand-maintained `schema.sql` was deleted precisely because it drifted), but
// applying nine files one at a time through a web SQL editor is tedious and
// easy to get wrong — and `supabase link` needs the database password, which
// an operator may not have to hand.
//
// So this concatenates them, in filename order, into one pasteable document.
// It is GENERATED, never hand-edited: the header says so, and re-running this
// script is what updates it. That keeps one source of truth while still
// offering a single paste.
//
//   node supabase/build-bootstrap.mjs        # rewrites supabase/bootstrap.sql
//   node supabase/build-bootstrap.mjs --check # exits 1 if it is stale
//
// Run the same command inside `supabase/tests/bootstrap.pglite.mjs` to prove
// the bundle applies cleanly before it is ever pasted into a real project.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, 'migrations');
const OUT = path.join(HERE, 'bootstrap.sql');

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

const rule = '─'.repeat(74);
const header = `-- ═══════════════════════════════════════════════════════════════════════
-- METALOID — complete database bootstrap (GENERATED — DO NOT EDIT)
--
-- Built by \`node supabase/build-bootstrap.mjs\` from supabase/migrations/,
-- which is the only source of truth. Edit a migration and re-run the script;
-- never edit this file, or it becomes the second description of the schema
-- that this project already had to delete once.
--
-- How to use it
--
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--   It is written to be re-runnable, so running it twice is harmless.
--
-- This runs on a real Supabase project, where the roles \`anon\`,
-- \`authenticated\` and \`service_role\`, the \`auth.uid()\` function and the
-- \`storage\` schema already exist (migration 0002 and 0003 depend on them).
--
-- It contains no secrets and no data — only DDL, grants and policies.
--
-- Verified automatically: supabase/tests/bootstrap.pglite.mjs applies this
-- exact text to a real PostgreSQL engine and fails if it does not apply
-- cleanly, so a broken bundle cannot reach a project.
--
-- Contents (${files.length} migrations, in order):
${files.map((f, i) => `--   ${String(i + 1).padStart(2)}. ${f}`).join('\n')}
-- ═══════════════════════════════════════════════════════════════════════

`;

const parts = files.map((f) => {
  const body = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').trimEnd();
  return `\n\n-- ${rule}\n-- ── ${f}\n-- ${rule}\n\n${body}\n`;
});

const bundle = header + parts.join('') + '\n';

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== bundle) {
    console.error('supabase/bootstrap.sql is stale — run: node supabase/build-bootstrap.mjs');
    process.exit(1);
  }
  console.log(`supabase/bootstrap.sql is up to date (${files.length} migrations, ${bundle.length} bytes)`);
} else {
  fs.writeFileSync(OUT, bundle, 'utf8');
  console.log(`wrote supabase/bootstrap.sql — ${files.length} migrations, ${bundle.length} bytes`);
}
