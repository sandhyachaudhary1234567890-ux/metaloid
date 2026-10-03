// The ONE backend entry point for the deployed application.
//
// This file is a thin adapter, not an implementation. It hands every /api/*
// request to the real gateway in server/src, so production runs exactly the
// code that runs locally: the same provider registry, model router, credential
// vault, memory, context engine, tool runtime and API-v1 contract. There is no
// second, simplified serverless backend to drift out of step with it — which
// is what previously let the deployed app ignore the model a user had saved.
//
// Two things have to happen before the gateway is imported:
//
//   0. The environment must be initialised. `server/src/auth.js` and
//      `server/src/openrouter.js` read process.env while being *evaluated*,
//      and ES imports are evaluated before the importing module's body — so
//      the loader has to be an import of this module, not a statement inside
//      it. Importing `server/src/env.js` first is what guarantees that.
//   1. METALOID_DATA_DIR must point somewhere writable. A serverless bundle is
//      read-only apart from /tmp, and a dozen core modules create their data
//      directory at module scope. Setting it here — not inside the handler —
//      is what makes the very first import succeed.
//   2. The gateway must not try to `listen()`. It detects VERCEL itself, and
//      METALOID_HEADLESS is set as well so the behaviour is explicit rather
//      than inferred from an environment we do not control.
//
// The dynamic import is deliberate: it defers loading ~50 modules until the
// first request, so a cold start is paid once per instance and the module
// top-level code above cannot be blocked by it.

import '../server/src/env.js';

// On a serverless host the only writable location is /tmp, and a deployment
// that accidentally shipped a `server/.env` must not be able to point the data
// directory at a read-only path and break every cold start. Off Vercel the
// existing behaviour is preserved exactly.
process.env.METALOID_DATA_DIR = process.env.VERCEL
  ? '/tmp/metaloid'
  : (process.env.METALOID_DATA_DIR || '/tmp/metaloid');
process.env.METALOID_HEADLESS = process.env.METALOID_HEADLESS || '1';

let appPromise = null;

function boot() {
  if (!appPromise) {
    appPromise = import('../server/src/index.js')
      .then((m) => m.app)
      .catch((e) => {
        // Reset so a transient failure does not poison the instance forever.
        appPromise = null;
        throw e;
      });
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await boot();
    // An express app is callable as (req, res).
    app(req, res);
  } catch (e) {
    // Never leak a stack trace or an internal path to a client. The message
    // stays generic; the detail goes to the platform log.
    console.error('[api] gateway boot failed:', e && e.message);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'The MetaIoid backend is starting up. Retry shortly.', code: 'booting' }));
    }
  }
}

// Streaming chat and long tool turns need room; everything else is fast.
export const config = { maxDuration: 60 };
