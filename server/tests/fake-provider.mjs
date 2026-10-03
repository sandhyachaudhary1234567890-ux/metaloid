// Fake OpenRouter, for tests and local development without a key.
//
// Usage (shell):
//   node server/tests/fake-provider.mjs --port 9911 --scenario failover
//
// Scenarios:
//   ok        every model streams a short answer
//   failover  the first N distinct models answer 400 "invalid parameters"
//             (the real dead-slug signature), then one streams
//   auth      everything answers 401 (bad key)
//   ratelimit everything answers 429
//   empty     200 + SSE with zero tokens (silent failure)
//   network   closes the socket without a response
//
// It exists because free model slugs churn constantly and the failover path
// is the difference between "answer" and "raw provider error in the UI".

import http from 'node:http';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const PORT = Number(args.get('port') || 9911);
const SCENARIO = args.get('scenario') || 'ok';
const FAIL_FIRST = Number(args.get('fail-first') || 1);

/** Model ids this fake has already rejected (per-process, like the real thing). */
const rejected = new Set();
const calls = [];

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  calls.push({ method: req.method, path: url.pathname });

  if (url.pathname === '/api/v1/models' || url.pathname === '/models') {
    if (SCENARIO === 'network') return req.socket.destroy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      data: [
        { id: 'fake/alpha:free', name: 'Fake Alpha', context_length: 8192 },
        { id: 'fake/beta:free', name: 'Fake Beta', context_length: 8192 },
        { id: 'fake/gamma:free', name: 'Fake Gamma', context_length: 8192 },
      ],
    }));
  }

  if (url.pathname === '/__calls') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(calls));
  }

  if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let model = '';
      try { model = JSON.parse(body).model || ''; } catch { /* ignore */ }

      if (SCENARIO === 'network') return req.socket.destroy();
      if (SCENARIO === 'auth') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } }));
      }
      if (SCENARIO === 'ratelimit') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } }));
      }
      if (SCENARIO === 'empty') return sse(res, []);
      if (SCENARIO === 'failover' && rejected.size < FAIL_FIRST && !rejected.has(model)) {
        rejected.add(model);
        // The exact shape OpenRouter returns for a dead/unentitled slug.
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: { message: 'The request contains invalid parameters. Check the request body for any errors or inconsistencies.', code: 400 },
        }));
      }
      sse(res, [
        { choices: [{ delta: { content: 'Answer ' } }] },
        { choices: [{ delta: { content: 'from ' } }] },
        { choices: [{ delta: { content: model || 'unknown' } }] },
      ]);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fake-provider] http://127.0.0.1:${PORT} scenario=${SCENARIO} fail-first=${FAIL_FIRST}`);
});

export { server };
