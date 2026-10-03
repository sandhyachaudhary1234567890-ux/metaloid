// Serves api/[...path].js exactly as the platform does, in the one
// configuration that matters for §19: hosted, and with NO token verifier
// configured at all.
//
// That is the dangerous misconfiguration — a deployment that forgot (or
// misspelled) its verifier. The legacy routes fall back to a local owner
// identity when no verifier exists, which on a developer's machine is a
// convenience and on a hosted deployment would be an anonymous route to the
// platform's provider credits. VERCEL marks the difference.
//
// This lives in its own process because the environment must be clean: a
// verifier set by any other test would make the fallback unreachable and the
// check would pass for the wrong reason.
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.VERCEL = '1';
process.env.METALOID_NO_DOTENV = '1';
delete process.env.SUPABASE_JWT_PUBLIC_KEY;
delete process.env.SUPABASE_JWT_SECRET;
delete process.env.SUPABASE_JWKS_URL;
process.env.METALOID_DATA_DIR = process.env.METALOID_DATA_DIR || '/tmp/metaloid-noauth';

const entry = await import(pathToFileURL(path.join(process.cwd(), 'api', '[...path].js')).href);
const server = http.createServer((req, res) => {
  Promise.resolve(entry.default(req, res)).catch((e) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e && e.message) }));
  });
});
server.listen(0, '127.0.0.1', () => console.log(`READY ${server.address().port}`));
