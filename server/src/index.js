// METALOID gateway — edge/API layer.
// Auth-less local V1 (binds 127.0.0.1): CORS-locked, rate-limited, timeouts.
// Keys live ONLY in process.env (server/.env). Nothing secret is logged
// or ever sent to the frontend.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { listFreeModels, pickModel, pickCandidates, retryableProviderError, classifyTask, streamChat } from './openrouter.js';
import { streamNvidia, NVIDIA_SMART } from './nvidia.js';
// NVIDIA fallback is OFF unless explicitly enabled: this account's key has
// no function entitlements (every model 404s "not found for account").
// Set NVIDIA_ENABLED=true only with an entitled key — otherwise failures
// would misleadingly report "both providers failed".
const NV_ON = process.env.NVIDIA_ENABLED === 'true';
import {
  COLLECTORS, validateTarget, createInvestigation, getInvestigation,
  runInvestigation, reportMarkdown, reportCSV,
} from './osint.js';
import { renderSystemPrompt, TOOLS_MANIFEST } from './systemPrompt.js';
// Agent runtime wiring (side-effect imports register skills + tools)
import './tools/catalog.js';
import './skills/osintSkill.js';
import './skills/researchSkill.js';
import { on as onEvent, recentAudit } from './core/events.js';
import { listTools, discoverTools, executeTool } from './core/tools.js';
import { listSkills, discoverSkills, skillBrief } from './core/skills.js';
import { grantApproval, pendingApprovals } from './core/permissions.js';
import { createMission, getMission, listMissions, runMission, pauseMission, cancelMission, markVerified, latestActive } from './core/missions.js';
import { planMission, startMission, continueMission, criticize, classifyIntent } from './core/agent.js';
import { remember, recall, forget, stats as memoryStats } from './core/memory.js';
import { upsertEntity, relate, neighbors, findEntities, worldStats, resolveLevel } from './core/world.js';
import { verify } from './core/verify.js';
import { track, trackModel, summary as observeSummary } from './core/observe.js';
import { ingestFindings } from './skills/osintSkill.js';
import { correlateExtracts } from './skills/researchSkill.js';

// Build Layer 2/9 runtime context from the client's (honest, capped) payload.
// Missing fields stay missing — the prompt forbids inventing them.
function buildRuntimeContext(c = {}) {
  const mems = Array.isArray(c.memories) ? c.memories.slice(0, 12) : [];
  const fmtMem = (m) => `- [${m.category || 'Personal'}] ${String(m.content || '').slice(0, 200)}`;
  const memText = mems.length ? mems.map(fmtMem).join('\n') : undefined;
  const projects = mems.filter((m) => m.category === 'Projects');
  const prefs = c.preferences && typeof c.preferences === 'object'
    ? Object.entries(c.preferences).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('; ') || undefined
    : undefined;
  return renderSystemPrompt({
    userName: typeof c.userName === 'string' && c.userName.trim() ? c.userName.trim().slice(0, 40) : undefined,
    datetime: new Date().toISOString(),
    tools: TOOLS_MANIFEST,
    memory: memText,
    preferences: prefs,
    projects: projects.length ? projects.map(fmtMem).join('\n') : undefined,
    goals: undefined,
    operatorNotes: undefined,
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// minimal .env loader (no dependency)
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
} catch { /* env optional */ }

const PORT = Number(process.env.PORT || 8787);
// BIND_HOST=0.0.0.0 exposes the gateway on the LAN (for phone testing).
// Local-only is the default; LAN mode prints an explicit warning at boot.
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const ORIGINS = (process.env.ALLOW_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173').split(',');
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const NV_KEY = process.env.NVIDIA_API_KEY || '';

const app = express();
// auto-allow the machine's own LAN origins (http + https) so phones on
// the same Wi-Fi work without hand-editing CORS (explicit list, never '*')
function lanOrigins() {
  const out = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) {
        out.push(`http://${n.address}:5173`, `https://${n.address}:5173`);
      }
    }
  }
  return out;
}
const ALLOWED = new Set([...ORIGINS, ...lanOrigins()]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.has(origin)) cb(null, true);
    else cb(new Error('CORS blocked'));
  },
}));
app.use(express.json({ limit: '256kb' }));

// ---- tiny in-memory rate limiter ----
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || 'local';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(ip, arr);
    if (arr.length > max) return res.status(429).json({ error: 'Rate limited. Slow down.' });
    next();
  };
}

// ---- observability wiring (user UI stays clean; debug surface here) ----
onEvent('*', (e) => track(e.type, e));

// ---- process armor: a single bad stream must never kill the gateway ----
// (Unhandled socket errors used to take the whole process down silently.)
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', String((e && e.stack) || e).slice(0, 500));
});
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', String((e && e.stack) || e).slice(0, 500));
  process.exitCode = 1;
});

// ---- health: REAL backend state (frontend shows this, never fakes it) ----
app.get('/api/health', async (req, res) => {
  const models = await listFreeModels().catch(() => []);
  const ai = OR_KEY.length > 10 && models.length > 0;
  res.json({
    ok: true,
    server: true,
    ai,
    voice: false, // STT/TTS providers plug in here (demo on frontend until then)
    vision: ai, // vision-capable free models route through the same chat path
    realtime: true, // SSE streaming live
    database: false, // V1: browser localStorage; server DB lands in V1.5
    models: { free: models.length },
  });
});

app.get('/api/models', async (req, res) => {
  const models = await listFreeModels().catch(() => []);
  res.json({ models, provider: 'openrouter', free_only: true });
});

// ---- chat: model router + streaming (SSE) ----
app.post('/api/chat', rateLimit(30, 60000), async (req, res) => {
  const { message, history = [], task } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 8000) {
    return res.status(400).json({ error: 'Invalid message.' });
  }
  if (!OR_KEY && !NV_KEY) return res.status(503).json({ error: 'No model provider configured.' });

  const messages = [
    ...history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
    { role: 'user', content: message },
  ];
  const tier = task && ['fast', 'smart', 'vision', 'coding', 'voice'].includes(task) ? task : classifyTask(message);
  const system = buildRuntimeContext(req.body?.context)
    + (tier === 'voice'
      ? '\n\nVOICE MODE: this reply will be SPOKEN aloud. Keep it to 1–3 short sentences, conversational, no markdown, no lists, no URLs, no code. Say numbers and units in words. If the full answer needs detail, speak the key point first in one sentence.'
      : '');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      controller.abort();
      const e = new Error('client gone');
      e.code = 'CLIENT_GONE';
      throw e;
    }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  // NOTE: res (not req) — req 'close' fires as soon as a POST body is
  // consumed, which would abort every stream instantly.
  res.on('close', () => controller.abort());
  // a dead client socket must end the stream, never the process
  res.on('error', () => {
    try {
      controller.abort();
    } catch { /* already settled */ }
  });
  const t0 = Date.now();
  let usedModel = '';
  let usedProvider = '';
  let usedTier = tier;

  try {
    const models = await listFreeModels();
    const candidates = pickCandidates(models, tier, 3);
    const model = candidates[0] || pickModel(models, tier);
    usedModel = model.id;
    usedProvider = 'openrouter';
    if (!OR_KEY) throw new Error('openrouter unconfigured');
    // try-next failover across free slugs (404 dead slug / 429 rate limit)
    let lastErr = null;
    let streamed = false;
    for (const cand of candidates) {
      try {
        usedModel = cand.id;
        send({ meta: { model: cand.id, tier, provider: 'openrouter', demo: false } });
        await streamChat({
          apiKey: OR_KEY, model: cand, messages, system,
          signal: controller.signal,
          onToken: (full) => send({ token: full }),
        });
        streamed = true;
        break;
      } catch (e) {
        lastErr = e;
        if (!retryableProviderError(e)) throw e;
        send({ retry: cand.id });
      }
    }
    if (!streamed) throw lastErr || new Error('openrouter failed');
    trackModel({ provider: 'openrouter', model: usedModel, tier, ms: Date.now() - t0, ok: true });
    send({ done: true });
  } catch (e) {
    // NVIDIA fallback only when entitled (see NV_ON)
    if (NV_KEY && NV_ON && (tier === 'smart' || tier === 'voice')) {
      try {
        usedProvider = 'nvidia';
        usedModel = NVIDIA_SMART;
        send({ meta: { model: NVIDIA_SMART, tier, provider: 'nvidia', demo: false } });
        await streamNvidia({
          apiKey: NV_KEY, messages, system,
          signal: controller.signal,
          onToken: (full) => send({ token: full }),
        });
        trackModel({ provider: 'nvidia', model: NVIDIA_SMART, tier, ms: Date.now() - t0, ok: true });
        send({ done: true });
      } catch (e2) {
        trackModel({ provider: usedProvider || 'openrouter', model: usedModel, tier, ms: Date.now() - t0, ok: false });
        send({ error: 'Both providers failed. Retry.' });
      }
    } else {
      trackModel({ provider: 'openrouter', model: usedModel, tier, ms: Date.now() - t0, ok: false });
      send({ error: 'Model provider failed. Retry.' });
    }
  } finally {
    clearTimeout(timer);
    res.end();
  }
});

// ---- OSINT investigations ----
app.post('/api/osint/investigations', rateLimit(10, 60000), (req, res) => {
  const v = validateTarget(req.body?.target);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const job = createInvestigation(v.target, v.type);
  res.status(201).json({ id: job.id, target: job.target, type: job.type, status: job.status });
});

app.post('/api/osint/investigations/:id/run', rateLimit(5, 60000), (req, res) => {
  const job = getInvestigation(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  res.status(202).json({ id: job.id, status: 'collecting' });
  runInvestigation(job.id).catch(() => {});
});

app.get('/api/osint/investigations/:id', (req, res) => {
  const job = getInvestigation(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  const { findings, ...rest } = job;
  res.json({ ...rest, counts: job.correlation, finding_count: findings.length });
});

app.get('/api/osint/investigations/:id/findings', (req, res) => {
  const job = getInvestigation(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  let list = job.findings;
  if (req.query.type && req.query.type !== 'all') list = list.filter((f) => f.type === req.query.type);
  if (req.query.confidence && req.query.confidence !== 'all') list = list.filter((f) => f.confidence === req.query.confidence);
  res.json({ findings: list });
});

app.get('/api/osint/investigations/:id/report', (req, res) => {
  const job = getInvestigation(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  const fmt = req.query.format || 'json';
  if (fmt === 'md') {
    res.type('text/markdown').send(reportMarkdown(job));
  } else if (fmt === 'csv') {
    res.type('text/csv').attachment(`${job.id}.csv`).send(reportCSV(job));
  } else {
    res.json({ investigation: { id: job.id, target: job.target, status: job.status }, findings: job.findings, timeline: job.timeline });
  }
});

app.get('/api/osint/collectors', (req, res) => {
  res.json({ collectors: COLLECTORS });
});

// ================= AGENT RUNTIME =================

// Skills
app.get('/api/skills', (req, res) => res.json({ skills: listSkills() }));
app.get('/api/skills/discover', (req, res) => {
  const ids = discoverSkills(String(req.query.q || ''));
  res.json({ skills: ids.map(skillBrief).filter(Boolean) });
});

// Tools (metadata only — execution goes through missions with permission gates)
app.get('/api/tools', (req, res) => res.json({ tools: listTools() }));
app.get('/api/tools/discover', (req, res) => res.json({ tools: discoverTools(String(req.query.q || '')) }));

// Approvals (permission engine queue)
app.get('/api/approvals', (req, res) => res.json({ pending: pendingApprovals() }));
app.post('/api/approvals/:id', rateLimit(20, 60000), (req, res) => {
  const a = grantApproval(req.params.id, req.body?.approved === true);
  if (!a) return res.status(404).json({ error: 'Unknown or decided approval.' });
  res.json({ approval: a });
});

// Missions
app.post('/api/missions', rateLimit(10, 60000), (req, res) => {
  const { objective, constraints, skillIds } = req.body || {};
  if (typeof objective !== 'string' || !objective.trim()) return res.status(400).json({ error: 'Objective required.' });
  const tasks = planMission(objective, Array.isArray(skillIds) && skillIds.length ? skillIds : discoverSkills(objective));
  const m = createMission({ objective, constraints, tasks, skillIds: discoverSkills(objective) });
  res.status(201).json({ mission: m });
});
app.get('/api/missions', (req, res) => res.json({ missions: listMissions() }));
app.get('/api/missions/active', (req, res) => {
  res.json({ mission: latestActive() });
});
app.get('/api/missions/:id', (req, res) => {
  const m = getMission(req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown mission.' });
  res.json({ mission: m });
});
app.post('/api/missions/:id/run', rateLimit(10, 60000), (req, res) => {
  const m = getMission(req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown mission.' });
  res.status(202).json({ id: m.id, status: 'RUNNING' });
  runMission(m.id, {}).catch(() => {});
});
app.post('/api/missions/:id/pause', (req, res) => {
  const m = pauseMission(req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown mission.' });
  res.json({ mission: m });
});
app.post('/api/missions/:id/cancel', (req, res) => {
  const m = cancelMission(req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown mission.' });
  res.json({ mission: m });
});
app.post('/api/missions/:id/verify', (req, res) => {
  const m = markVerified(req.params.id, req.body?.note || '');
  if (!m) return res.status(404).json({ error: 'Only COMPLETED missions can be verified.' });
  res.json({ mission: m });
});

// Agent: natural-language mission ops (continue / criticize / intent)
app.post('/api/agent/mission', rateLimit(10, 60000), async (req, res) => {
  const { objective, constraints } = req.body || {};
  if (typeof objective !== 'string' || !objective.trim()) return res.status(400).json({ error: 'Objective required.' });
  const models = await listFreeModels().catch(() => []);
  const model = pickModel(models, 'smart');
  const m = await startMission({ objective, constraints, apiKey: OR_KEY, model });
  res.status(201).json({ mission: m });
});
app.post('/api/agent/continue', rateLimit(10, 60000), async (req, res) => {
  res.json(await continueMission());
});
app.post('/api/agent/criticize', rateLimit(20, 60000), async (req, res) => {
  res.json(await criticize(req.body?.draft ?? ''));
});
app.get('/api/agent/intent', (req, res) => {
  res.json(classifyIntent(String(req.query.q || '')));
});

// Memory (server-side classes; frontend memory stays local-first)
app.post('/api/memory', rateLimit(30, 60000), (req, res) => {
  const r = remember({ cls: req.body?.class, content: req.body?.content, source: 'api', confidence: req.body?.confidence });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json({ record: r.record });
});
app.get('/api/memory', (req, res) => {
  res.json({ records: recall({ cls: req.query.class, query: String(req.query.q || '') }), stats: memoryStats() });
});
app.delete('/api/memory/:id', (req, res) => {
  const r = forget(req.params.id);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json({ ok: true });
});

// World model
app.post('/api/world/entities', rateLimit(30, 60000), (req, res) => {
  const { type, name, aliases } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'type + name required.' });
  res.status(201).json({ entity: upsertEntity({ type, name, aliases, source: 'api' }) });
});
app.get('/api/world/entities', (req, res) => {
  res.json({ entities: findEntities(String(req.query.q || ''), req.query.type) });
});
app.post('/api/world/relate', rateLimit(30, 60000), (req, res) => {
  const r = relate(req.body?.from, req.body?.to, req.body?.rel, { source: 'api', evidence: req.body?.evidence });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json({ edge: r.edge });
});
app.get('/api/world/graph', (req, res) => {
  if (!req.query.id) return res.json({ stats: worldStats() });
  res.json(neighbors(String(req.query.id), Math.min(Number(req.query.depth || 1), 3)));
});
app.get('/api/world/resolve', (req, res) => {
  res.json({ level: resolveLevel(String(req.query.a || ''), String(req.query.b || '')) });
});

// Verification
app.post('/api/verify', rateLimit(30, 60000), async (req, res) => {
  res.json(await verify(req.body?.value ?? null, req.body?.checks || ['nonempty']));
});

// Research helpers (deterministic correlation)
app.post('/api/research/correlate', rateLimit(30, 60000), (req, res) => {
  res.json(correlateExtracts(req.body?.a || '', req.body?.b || ''));
});

// OSINT → world ingestion
app.post('/api/osint/investigations/:id/ingest', rateLimit(10, 60000), (req, res) => {
  const job = getInvestigation(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  res.json(ingestFindings(job.target, job.findings));
});

// Observability (debug surface — not user UI)
app.get('/api/debug/summary', (req, res) => {
  res.json({ ...observeSummary(), world: worldStats(), memory: memoryStats(), audit: recentAudit(30) });
});

// TLS when LAN certs exist (server/../certs from certs-gen.mjs) — required
// because an https page may not call an http gateway (mixed content), and
// the phone needs https for mic access at all.
const certDir = path.join(__dirname, '..', '..', 'certs');
const tlsOn =
  fs.existsSync(path.join(certDir, 'key.pem')) && fs.existsSync(path.join(certDir, 'cert.pem'));
const serve = tlsOn
  ? https.createServer(
      { key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) },
      app
    )
  : app;

serve.listen(PORT, BIND_HOST, () => {
  console.log(`metaloid-gateway ${tlsOn ? 'https' : 'http'}://${
    BIND_HOST === '0.0.0.0' ? '<lan-ip>' : BIND_HOST
  }:${PORT} (openrouter:${OR_KEY ? 'set' : 'missing'} nvidia:${NV_ON && NV_KEY ? 'enabled' : 'off'})`);
  if (BIND_HOST === '0.0.0.0') {
    console.log('WARNING: gateway is reachable on your LAN. Same-WiFi only; never expose this port to the internet (it fronts paid API keys).');
  }
});
