// METALOID gateway — edge/API layer.
// Multi-user platform: every session resolves to {userId, accountId,
// sessionId, deviceId} via Bearer token. All user-owned resources are
// scoped server-side; ownership is enforced at the data-access boundary,
// never trusted from the frontend. Public surface: / and /api/health and
// /api/auth/* — everything else requires auth.
// Keys live ONLY in process.env (server/.env). Nothing secret is logged
// or ever sent to the frontend.

// MUST stay the first import in this file, and in every other entry point.
//
// ES imports are evaluated before this module's body, so `./env.js` has to be
// listed ahead of every module that reads process.env at module scope (auth.js,
// openrouter.js, core/*). Moving it down, or deleting it on the assumption that
// the `listen()` block below is "early enough", reintroduces the bug where a
// `.env`-configured gateway reports `auth.configured:false`. See env.js.
import './env.js';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import {
  listFreeModels, pickModel, pickCandidates, retryableProviderError, classifyTask, streamChat,
  markModelDead, modelHealth, catalogueStatus, PROVIDER_LABEL,
  modelSpecificFailure, humanizeProviderError,
} from './openrouter.js';
import { mountV1 } from './api/v1.js';
import { authConfigured, authMode } from './auth.js';
import { requireIdentity } from './identity.js';
import { ping as dbPing, storagePing, driverInfo } from './data/index.js';
import { streamNvidia, NVIDIA_SMART } from './nvidia.js';
// Provider Platform imports
import { listProviders, getProvider, getProviderModels, updateProvider } from './core/providerRegistry.js';
import { storeUserCredential, getUserCredential, deleteUserCredential, rotateUserCredential, rotateUserCredentialById, listUserCredentialProviders, setCredentialTestStatus, getCredentialTestStatus, getCredentialAuditLog, deleteUserCredentials } from './core/credentialVault.js';
import { OpenRouterAdapter, NvidiaAdapter, ErrorTypes } from './core/providerAdapter.js';
import { getAdapter, supportedProviders } from './core/providerAdapters.js';
import { chatWithProviders } from './core/providerGateway.js';
import { prefsFor } from './core/accountBridge.js';
import { providerUsageSummary, deleteProviderUsage } from './core/providerMeters.js';
import { createRoutingEngine } from './core/providerRouter.js';
import { getHealthManager, getProviderHealth, recordProviderCall } from './core/providerHealth.js';
import { listModels, getModel, getModelStats, syncModelsFromRegistry } from './core/modelCatalog.js';
// NVIDIA fallback is OFF unless explicitly enabled: this account's key has
// no function entitlements (every model 404s "not found for account").
// Set NVIDIA_ENABLED=true only with an entitled key — otherwise failures
// would misleadingly report "both providers failed".
const NV_ON = process.env.NVIDIA_ENABLED === 'true';
import {
  COLLECTORS, validateTarget, createInvestigation, getInvestigationFor, listInvestigations,
  runInvestigation, reportMarkdown, reportCSV, deleteUserInvestigations,
} from './osint.js';
import { renderSystemPrompt, TOOLS_MANIFEST } from './systemPrompt.js';
// Identity + user layer
import {
  createUser, verifyUser, createSession, refreshSession, revokeSession,
  revokeAllSessions, listSessions, getUser, userCount, deleteUserCascade,
  requireAuth, optionalAuth, requireAdmin,
} from './core/users.js';
import { getProfile, updateProfile, completeOnboarding, deleteProfile, personalizationBlock } from './core/profiles.js';
import { getPlan, planCaps, can, checkBudget, recordUsage, usageSummary, deleteUsage } from './core/entitlements.js';
import {
  listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace, deleteUserWorkspaces,
  requestPairing, confirmPairing, listDevices, revokeDevice, authorizeDevice, deleteUserDevices,
} from './core/workspaces.js';
import { adoptLegacyRecords, deleteUserMemories, exportMemories } from './core/memory.js';
import { adoptLegacyMissions, deleteUserMissions } from './core/missions.js';
import { adoptLegacyWorld, deleteUserWorld } from './core/world.js';
import { deleteUserApprovals } from './core/permissions.js';
import {
  createArtifact, editArtifact, editSlide, validateArtifact, renderArtifact, finalizeArtifact,
  getArtifact, listArtifacts, visualQA, repairArtifact, deleteArtifact,
  downloadArtifact, deleteUserArtifacts, detectRenderer, failArtifact, MIME,
} from './core/artifacts.js';
import { complete as orComplete } from './openrouter.js';
// Agent runtime wiring (side-effect imports register skills + tools)
import './tools/catalog.js';
import './skills/osintSkill.js';
import './skills/researchSkill.js';
import { on as onEvent, recentAudit } from './core/events.js';
import { listTools, discoverTools, executeTool } from './core/tools.js';
import { listSkills, discoverSkills, skillBrief } from './core/skills.js';
import {
  visibleSkills, getSkillFor, skillCard, listSkillCards, installSkill,
  updateSkill, rollbackSkill, setSkillStatus, deleteSkill, duplicateSkill,
  inspectSkill, readSkillFile, skillAudit, registerSystemSkill, deleteUserSkills,
  diffVersions,
} from './core/skillStore.js';
import { adapterStatus } from './core/skillRuntimes.js';
import { registerSchedule, listSchedules, removeSchedule, runScheduled, deleteUserSchedules } from './core/skillTasks.js';
import { submitJob, getJob, listJobs, queueStats, deleteUserJobs } from './core/jobs.js';
import { validatePackage, packageFromFields } from './core/skillPackage.js';
import { discoverFor, findByCommand, missingDeps } from './core/skillDiscovery.js';
import { testSkill, invokeSkill } from './core/skillRuntime.js';
import { grantApproval, pendingApprovals } from './core/permissions.js';
import { createMission, getMission, listMissions, runMission, pauseMission, cancelMission, markVerified, latestActive } from './core/missions.js';
import { planMission, startMission, continueMission, criticize, classifyIntent } from './core/agent.js';
import { resolveIntentCapability, capabilityCatalog } from './core/intentCapabilityResolver.js';
import { remember, recall, forget, updateMemory, forgetAll, stats as memoryStats } from './core/memory.js';
import { upsertEntity, relate, neighbors, findEntities, worldStats, resolveLevel } from './core/world.js';
import { verify } from './core/verify.js';
import { track, trackModel, summary as observeSummary } from './core/observe.js';
import { ingestFindings } from './skills/osintSkill.js';
import { correlateExtracts } from './skills/researchSkill.js';

// Build Layer 2/9 runtime context from the client's (honest, capped) payload.
// Missing fields stay missing — the prompt forbids inventing them.
// Server-side personalization (user-confirmed profile) is appended by the
// caller and always wins over client claims about identity/preferences.
function buildRuntimeContext(c = {}, personalization = '') {
  const mems = Array.isArray(c.memories) ? c.memories.slice(0, 12) : [];
  const fmtMem = (m) => `- [${m.category || 'Personal'}] ${String(m.content || '').slice(0, 200)}`;
  const memText = mems.length ? mems.map(fmtMem).join('\n') : undefined;
  const projects = mems.filter((m) => m.category === 'Projects');
  const prefs = c.preferences && typeof c.preferences === 'object'
    ? Object.entries(c.preferences).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('; ') || undefined
    : undefined;
  // Active skills: auto-discovered for this task (client passes L2 briefs it
  // explicitly loaded; shape validated here, max 2, instructions capped).
  const skillCtx = Array.isArray(c.skills) ? c.skills.slice(0, 2).filter((s) => s && typeof s.name === 'string' && typeof s.instructions === 'string') : [];
  const skillsBlock = skillCtx.length
    ? '\n\nACTIVE SKILLS (discovered relevant to this task — follow their workflow, then verify per their policy):\n' +
      skillCtx.map((s) => `### ${s.name.slice(0, 60)}\n${String(s.description || '').slice(0, 300)}\n${s.instructions.slice(0, 2500)}`).join('\n\n')
    : '';
  return renderSystemPrompt({
    userName: typeof c.userName === 'string' && c.userName.trim() ? c.userName.trim().slice(0, 40) : undefined,
    datetime: new Date().toISOString(),
    tools: TOOLS_MANIFEST,
    memory: memText,
    preferences: prefs,
    projects: projects.length ? projects.map(fmtMem).join('\n') : undefined,
    goals: undefined,
    operatorNotes: undefined,
  }) + (personalization || '') + skillsBlock;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Environment configuration is loaded by `./env.js`, which is imported at the
// top of this file. It has to run before the imports above are evaluated, so
// there is deliberately no loader here any more.

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.METALOID_DATA_DIR || path.join(__dirname, '..', 'data');
// BIND_HOST=0.0.0.0 exposes the gateway on the LAN/web (for phone testing and web hosting).
// Local-only is the default; LAN mode prints an explicit warning at boot.
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
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
/**
 * Explicit origin allowlist. Anything not listed is refused — no wildcard,
 * no "reflect any origin" fallback, because these APIs carry credentials.
 *
 *   ALLOW_ORIGINS           comma-separated exact origins (production web app)
 *   ALLOW_VERCEL_PREVIEWS   "true" to also allow *.vercel.app preview URLs
 *   ALLOW_MOBILE_ORIGINS    comma-separated (Capacitor / Android shell origins)
 *   ALLOW_LOCAL_ORIGINS     "true" to allow localhost/LAN (dev + showcase only)
 */
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOW_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
);
// The deployment's own origin must always be allowed, even when the operator
// forgot to list it in ALLOW_ORIGINS (the exact outage that broke browser
// login on Vercel). PUBLIC_APP_URL is ours; Vercel injects VERCEL_URL /
// VERCEL_PROJECT_PRODUCTION_URL automatically.
for (const v of [process.env.PUBLIC_APP_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`]) {
  const s = String(v || '').trim().replace(/\/$/, '');
  if (s) ALLOWED_ORIGINS.add(s);
}
const ALLOWED_MOBILE = new Set(
  (process.env.ALLOW_MOBILE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
);
const ALLOW_VERCEL_PREVIEWS = process.env.ALLOW_VERCEL_PREVIEWS === 'true';
const ALLOW_LOCAL_ORIGINS = process.env.ALLOW_LOCAL_ORIGINS === 'true'
  || process.env.METALOID_MODE === 'showcase'
  || process.env.NODE_ENV !== 'production';

function isAllowedOrigin(origin) {
  if (!origin) return true;               // same-origin / curl / native app
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (ALLOWED_MOBILE.has(origin)) return true;
  try {
    const h = new URL(origin).hostname;
    if (ALLOW_VERCEL_PREVIEWS && h.endsWith('.vercel.app')) return true;
    // Single-project deployments (metaloid.vercel.app serving both app + API
    // same-origin) must never be blocked by a missing allowlist entry: the
    // browser's Origin always matches the deployment that served it.
    // This is safe because it only allows the host Vercel assigned to us.
    const ownHosts = new Set();
    for (const v of [process.env.PUBLIC_APP_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL]) {
      try {
        const u = String(v || '').trim();
        if (!u) continue;
        ownHosts.add(new URL(u.includes('://') ? u : `https://${u}`).hostname);
      } catch { /* ignore malformed */ }
    }
    if (ownHosts.has(h)) return true;
    if (ALLOW_LOCAL_ORIGINS && (h === 'localhost' || h === '127.0.0.1'
      || h.startsWith('192.168.') || h.startsWith('10.')
      || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h))) return true;
  } catch { /* malformed origin → refuse */ }
  return false;
}

app.use(cors({
  origin: (origin, cb) => {
    cb(null, isAllowedOrigin(origin));
  },
  credentials: true,
}));

// SECURITY: Content Security Policy headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Content Security Policy (basic implementation for localStorage-based auth)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Allow inline scripts for Vite dev
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  
  next();
});

app.use(express.json({ limit: '3mb' })); // 256kb would 413 skill-ZIP payloads (1.5MB archive cap enforced inside skillZip.js); rate limits still apply per route

// Supabase-backed account data (profiles, conversations, messages, memories,
// provider credentials, attachments, tasks, usage). Every route is behind
// requireAuth and ownership is enforced in Postgres by RLS.
mountV1(app);

// ---- request IDs + structured access log (method/path/status/ms/user —
// NEVER secrets, tokens, keys, or bodies) ----
let reqSeq = 0;
app.use((req, res, next) => {
  const id = `rq-${Date.now().toString(36)}-${(++reqSeq).toString(36)}`;
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  const t0 = Date.now();
  res.on('finish', () => {
    const user = req.auth?.userId || '-';
    console.log(`[req] ${id} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms user=${user}`);
  });
  next();
});

/** Normalized error categories (client gets category + action, never stacks). */
export function categorizeError(e, fallback = 'UNKNOWN_ERROR') {
  const msg = String((e && e.message) || e || '');
  if (/AUTH_REQUIRED|sign in|401/.test(msg)) return { category: 'AUTH_ERROR', message: 'Sign in required.', retryable: false };
  if (e && e.code === 'ALL_PROVIDERS_FAILED') return { category: 'PROVIDER_ERROR', message: msg.slice(0, 220), retryable: true };
  if (/quota|429|rate/i.test(msg)) return { category: 'RATE_LIMIT', message: 'Rate limited — wait a moment and retry.', retryable: true };
  if (/timeout|abort|ECONN|ENOTFOUND|socket/i.test(msg)) return { category: 'NETWORK_ERROR', message: 'Network issue reaching the provider. Retry.', retryable: true };
  if (/budget/i.test(msg)) return { category: 'RATE_LIMIT', message: msg.slice(0, 200), retryable: false };
  if (/validation|invalid|bad request/i.test(msg)) return { category: 'MODEL_ERROR', message: msg.slice(0, 200), retryable: false };
  return { category: fallback, message: 'Something went wrong. Retry.', retryable: false };
}

// ---- tiny in-memory rate limiter (per-route buckets: every rateLimit()
// instance owns its map — a shared map would let mixed activity on one IP
// trip unrelated routes. Keyed by authed user when present so one NAT IP
// never throttles every user behind it.) ----
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = (req.auth && req.auth.userId) ? `u:${req.auth.userId}` : `ip:${req.ip || 'local'}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (arr.length > max) return res.status(429).json({ error: 'Rate limited. Slow down.', category: 'RATE_LIMIT', requestId: req.requestId });
    next();
  };
}

/** Cursor-free pagination for list endpoints: ?limit=&offset= (capped).
 * Defaults preserve old behavior (full list) unless the client pages. */
export function paginate(arr, req, maxLimit = 100) {
  const raw = Number(req.query.limit);
  if (!Number.isFinite(raw) || raw <= 0) return { items: arr, total: arr.length, paged: false };
  const limit = Math.min(Math.floor(raw), maxLimit);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { items: arr.slice(offset, offset + limit), total: arr.length, limit, offset, paged: true };
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

// ---- no request may hang unanswered ----
// Express 4 does not catch a rejected async handler. The promise rejects, the
// process logs [unhandledRejection], and no response is ever written — so the
// client waits indefinitely and the user sees a permanent "Thinking…" with no
// error and nothing to retry. That is exactly the state the product is not
// allowed to reach, and it was reachable: POST /api/missions awaited nothing
// and called .map on a promise, so it could never answer a single request.
//
// A bug must surface as an error rather than as silence. This is a backstop,
// not a licence to be slow: the cap sits under the platform's own function
// limit so our message wins the race. Streaming routes are untouched — they
// send headers immediately, and this only fires when nothing has been written.
const RESPONSE_TIMEOUT_MS = Number(process.env.METALOID_RESPONSE_TIMEOUT_MS || 50_000);
app.use((req, res, next) => {
  const timer = setTimeout(() => {
    if (res.headersSent || res.writableEnded) return;
    console.error(`[timeout] ${req.method} ${req.originalUrl} produced no response in ${RESPONSE_TIMEOUT_MS}ms`);
    res.status(504).json({
      error: 'The request took too long and was stopped. Please try again.',
      code: 'upstream_timeout',
    });
  }, RESPONSE_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  const done = () => clearTimeout(timer);
  res.on('finish', done);
  res.on('close', done);
  next();
});

// Root: friendly status instead of "Cannot GET /" when opened in a browser.
app.get('/', (req, res) => {
  res.json({
    service: 'metaloid-gateway',
    ok: true,
    usage: 'API only — the app UI lives on the frontend deployment.',
    health: '/api/health',
  });
});

// ---- health: measured state only. Nothing here is asserted because an env
// var exists: the provider is probed, the data driver is pinged, and auth
// reports whether tokens can actually be verified right now. ----
app.get('/api/health', async (req, res) => {
  const [db, storage, models] = await Promise.all([
    dbPing().catch((e) => ({ ok: false, detail: String((e && e.message) || e) })),
    storagePing().catch((e) => ({ ok: false, detail: String((e && e.message) || e) })),
    listFreeModels().catch(() => []),
  ]);
  const providerSet = OR_KEY.length > 10 || (NV_ON && NV_KEY.length > 10);
  const cat = catalogueStatus();
  const live = models.filter((m) => !modelHealth().quarantined.some((q) => q.id === m.id)).length;
  // ai = "a reply can plausibly be produced": a key exists AND the provider
  // answered our catalogue call. A key with no network is degraded, not online.
  const ai = providerSet && cat.ok && live > 0;
  const info = driverInfo();
  const databaseReady = Boolean(db && db.ok);
  const storageReady = Boolean(storage && storage.ok);
  // "reachable" means tokens can actually be verified right now: auth is
  // configured AND the data layer it verifies against is answering. A mode
  // with no auth (local demo) is honestly reachable because nothing is asked.
  const authConfiguredNow = authConfigured();
  const authState = {
    configured: authConfiguredNow,
    mode: authMode(),
    reachable: authConfiguredNow ? databaseReady : true,
  };
  res.json({
    ok: true,
    server: true,
    ai,
    degraded: !ai && providerSet,
    provider: providerSet ? PROVIDER_LABEL : null,
    voice: false,                          // speech runs in the browser, not here
    vision: ai,                            // vision models ride the same chat path
    realtime: true,                        // SSE streaming is live in this process
    database: databaseReady,
    auth: authState,                       // object: configured / mode / reachable
    authState,
    storage: { ready: storageReady, driver: (storage && storage.driver) || info.storage, buckets: (storage && storage.buckets) || null },
    data: { driver: info.driver, supabase_configured: info.supabase_configured, url_set: info.supabase_url_set },
    encryption: { configured: info.encryption.configured, active_key: info.encryption.activeKeyId },
    // "free models" is only a number once a provider key can actually reach
    // them; without a key the catalogue is a plan, not availability.
    models: {
      free: providerSet ? live : 0,
      total: models.length,
      catalogue: cat.ok,
      at: cat.at || null,
    },
    at: new Date().toISOString(),
  });
});

// ---- readiness: alive AND actually ready (deps OK), unlike /health ----
app.get('/api/ready', (req, res) => {
  const checks = { process: true, dataDir: false, registry: false };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    checks.dataDir = true;
  } catch { /* not writable */ }
  try {
    checks.registry = supportedProviders().length > 0 && listProviders().length > 0;
  } catch { /* registry broken */ }
  const ready = checks.process && checks.dataDir && checks.registry;
  res.status(ready ? 200 : 503).json({ ready, checks });
});

// ---- public runtime config: browser-safe values only ----
// Vercel refuses to save JWT-looking values with a VITE_ prefix as Secret,
// and Config-typed vars only reach the *server* (Vite inlines VITE_ at build
// time, so post-build env changes are invisible to the bundle anyway).
// The anon key + project URL are public by design (RLS is what protects
// data), so the browser fetches them here when the build-time env is empty.
// NEVER add service-role keys, JWT secrets, encryption keys, or provider
// API keys to this response.
app.get('/api/config', (req, res) => {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const anon = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    supabaseUrl: url || null,
    supabaseAnonKey: anon || null,
    configured: Boolean(url && anon),
  });
});

// ================= AUTH (public) =================

const authLimit = rateLimit(Number(process.env.METALOID_AUTH_LIMIT || 10), 60000);

app.post('/api/auth/signup', authLimit, async (req, res) => {
  const { handle, displayName, passcode, deviceName } = req.body || {};
  const r = createUser({ handle, displayName, passcode });
  if (!r.ok) return res.status(400).json({ error: r.error });
  // single-user upgrade: adopt pre-multi-user records into the first account
  if (userCount() === 1) {
    adoptLegacyRecords(r.user.id);
    adoptLegacyMissions(r.user.id);
    adoptLegacyWorld(r.user.id);
  }
  const s = createSession(r.user.id, { deviceName });
  res.status(201).json({ user: r.user, profile: await getProfile(r.user.id), ...s });
});

app.post('/api/auth/login', authLimit, async (req, res) => {
  const { handle, passcode, deviceId, deviceName } = req.body || {};
  const v = verifyUser(handle, passcode);
  if (!v.ok) return res.status(401).json({ error: v.error });
  const s = createSession(v.user.id, { deviceId, deviceName });
  const { passHash, salt, ...pub } = v.user;
  void passHash; void salt;
  res.json({ user: pub, profile: await getProfile(v.user.id), ...s });
});

app.post('/api/auth/refresh', authLimit, (req, res) => {
  const s = refreshSession(req.body?.refresh || '');
  if (!s) return res.status(401).json({ error: 'Session expired. Sign in again.', code: 'AUTH_REQUIRED' });
  res.json(s);
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  revokeSession(req.auth.sessionId, req.auth.userId);
  res.json({ ok: true });
});

/** Logout everywhere: kills ALL sessions of this user (all devices). */
app.post('/api/auth/logout-all', requireAuth, (req, res) => {
  res.json({ ok: true, revoked: revokeAllSessions(req.auth.userId) });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  if (req.auth.via === 'supabase') {
    return res.json({
      user: { id: req.auth.userId, handle: (req.auth.email || 'supabase-user').split('@')[0], displayName: '', role: 'user', via: 'supabase', email: req.auth.email || null },
      profile: await getProfile(req.auth.userId),
      session: req.auth,
      usage: await usageSummary(req.auth.userId),
    });
  }
  const u = getUser(req.auth.userId);
  if (!u) return res.status(401).json({ error: 'Sign in required.', code: 'AUTH_REQUIRED' });
  const { passHash, salt, ...pub } = u;
  void passHash; void salt;
  res.json({ user: pub, profile: await getProfile(u.id), session: req.auth, usage: await usageSummary(u.id) });
});

app.get('/api/auth/sessions', requireAuth, (req, res) => {
  res.json({ sessions: listSessions(req.auth.userId) });
});

app.delete('/api/auth/sessions/:id', requireAuth, (req, res) => {
  if (!revokeSession(req.params.id, req.auth.userId)) return res.status(404).json({ error: 'Unknown session.' });
  res.json({ ok: true });
});

app.get('/api/models', async (req, res) => {
  const all = await listFreeModels().catch(() => []);
  const dead = new Set(modelHealth().quarantined.map((q) => q.id));
  // live first; quarantined slugs are flagged, never hidden, so the UI can say
  // why a model is missing instead of silently dropping it
  const models = all.map((m) => ({ ...m, unavailable: dead.has(m.id) }));
  res.json({ models, provider: PROVIDER_LABEL, free_only: true, mock: PROVIDER_LABEL !== 'openrouter' });
});

/**
 * Stable, non-leaky error codes for the UI. The frontend switches on these
 * (and only these) so provider churn never changes what a user sees:
 *   no_provider - bad_key - no_credit - rate_limited - no_model - offline - timeout - cancelled - server
 */
function providerCodeOf(e) {
  const s = e && e.status;
  if (e && e.code === 'NO_PROVIDER') return 'no_provider';
  if (e && e.code === 'CLIENT_GONE') return 'cancelled';
  if (s === 401) return 'bad_key';
  if (s === 402) return 'no_credit';
  if (s === 429) return 'rate_limited';
  if (s === 400 || s === 404) return 'no_model';
  if (s >= 500) return 'server';
  const msg = String((e && e.message) || '');
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(msg)) return 'offline';
  if (/aborted|timeout/i.test(msg)) return 'timeout';
  return 'server';
}

// ---- chat: model router + streaming (SSE), per-user metered ----
app.post('/api/chat', requireAuth, rateLimit(60, 60000), async (req, res) => {
  const { message, history = [], task } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 8000) {
    return res.status(400).json({ error: 'Invalid message.' });
  }
  if (!OR_KEY && !NV_KEY) return res.status(503).json({ error: 'No model provider configured.' });
  // The route is behind requireAuth, so a locally-verified subject always
  // exists; reading it from one place is what keeps the model the user saved
  // visible to the router in the same request.
  const userId = requireIdentity(req);

  // Vercel/serverless fix: flush SSE headers BEFORE any slow work.
  // Hobby plans kill a function that sends nothing in the first ~10s, and
  // cold-start + JWKS + DB + catalogue fetch easily exceeds that. Sending
  // headers + a comment immediately keeps proxies/buffers from timing out,
  // and the heartbeat below keeps the stream alive while OpenRouter's free
  // tier thinks (TTFT is often 5-15s). Frontend ignores non-data: lines.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') {
    try { res.flushHeaders(); } catch { /* non-critical */ }
  }
  try { res.write(': connected\n\n'); } catch { /* client already gone */ }
  const controller = new AbortController();
  // Stay under the platform limit (Vercel maxDuration 60s + our 50s
  // no-response guard): abort upstream at 50s so we send a clean SSE error
  // instead of the platform's opaque 504.
  const timer = setTimeout(() => controller.abort(), 50000);
  const heartbeat = setInterval(() => {
    try {
      if (!res.writableEnded) res.write(': ping\n\n');
    } catch { /* closed below */ }
  }, 8000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
  const stopHeartbeat = () => clearInterval(heartbeat);
  // NOTE: res (not req) — req 'close' fires as soon as a POST body is
  // consumed, which would abort every stream instantly.
  res.on('close', () => { stopHeartbeat(); controller.abort(); });
  // a dead client socket must end the stream, never the process
  res.on('error', () => {
    stopHeartbeat();
    try {
      controller.abort();
    } catch { /* already settled */ }
  });
  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      stopHeartbeat();
      controller.abort();
      const e = new Error('client gone');
      e.code = 'CLIENT_GONE';
      throw e;
    }
  };
  const failAndEnd = (errObj) => {
    try { send(errObj); } catch { /* client gone */ }
    clearTimeout(timer);
    stopHeartbeat();
    try { res.end(); } catch { /* already ended */ }
  };
  const t0 = Date.now();

  // Budget is checked after headers are sent, so a rejection must be an SSE
  // error event (HTTP status is already 200) — not a JSON status.
  // A budget-store outage must never brick chat: fail open with a log line
  // (usage simply goes uncounted) rather than fail closed on a metrics error.
  let budget = { ok: true };
  try {
    budget = await checkBudget(userId, 'chat');
  } catch (e) {
    console.error('[gateway] budget check unavailable, allowing chat:', String((e && e.message) || e).slice(0, 160));
  }
  if (!budget.ok) {
    failAndEnd({ error: budget.error || 'Budget exceeded. Try again later.', code: 'rate_limited' });
    return;
  }
  // Usage telemetry must never break a reply: a failed write is logged and
  // the stream continues.
  const countUsage = () => recordUsage(userId, 'chat').catch((e) => {
    console.error('[gateway] usage record failed:', String((e && e.message) || e).slice(0, 160));
  });

  const messages = [
    ...history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
    { role: 'user', content: message },
  ];
  const tier = task && ['fast', 'smart', 'vision', 'coding', 'voice'].includes(task) ? task : classifyTask(message);
  // Parallelize profile + personalization (two DB reads) so pre-stream
  // latency is one round-trip, not two. Failures fall back to anonymous
  // context — never fail a chat on a profile read.
  const [profile, personalization] = await Promise.all([
    Promise.resolve().then(() => getProfile(userId)).catch(() => ({})),
    Promise.resolve().then(() => personalizationBlock(userId)).catch(() => ''),
  ]);
  const ctx = { ...(req.body?.context || {}) };
  if (profile && profile.displayName) ctx.userName = profile.displayName;
  const system = buildRuntimeContext(ctx, personalization || '')
    + (tier === 'voice'
      ? '\n\nVOICE MODE: this reply will be SPOKEN aloud. Keep it to 1–3 short sentences, conversational, no markdown, no lists, no URLs, no code. Say numbers and units in words. If the full answer needs detail, speak the key point first in one sentence.'
      : '');
  let usedModel = '';
  let usedProvider = '';
  let usedTier = tier;
  void usedTier;

  // BYOK first: the user's own connected providers (ordered by their
  // routing prefs + health) stream here; platform keys stay as fallback.
  let byokError = null;
  try {
    // Reuse the profile already fetched above — a second DB read here added
    // ~500ms on every cold start for no reason.
    const out = await chatWithProviders({
      userId: userId, messages, system, prefs: profile || {},
      // The classified tier drives candidate ordering, so a voice turn asks
      // for a fast model and a coding turn for a coding one.
      task: tier,
      signal: controller.signal,
      onToken: (full) => send({ token: full }),
      onAttempt: (a) => send({ meta: { model: a.model, tier, provider: a.providerId, demo: false, byok: true } }),
    });
    usedModel = out.model;
    usedProvider = out.providerId;
    trackModel({ provider: out.providerId, model: out.model, tier, ms: Date.now() - t0, ok: true });
    await countUsage();
    send({ done: true });
    clearTimeout(timer);
    stopHeartbeat();
    res.end();
    return;
  } catch (e) {
    if (e && e.code === 'NO_CREDENTIALS') {
      // no BYOK — legacy platform-key path below
    } else {
      byokError = e; // tried user providers; platform path is the safety net
    }
  }

  try {
    // Catalogue + account prefs in parallel: sequential awaits cost ~1-2s on
    // cold start (catalogue fetch + DB read). Either failure falls back —
    // catalogue to the static free list, prefs to {} — never a hard fail.
    const [models, accountPrefs] = await Promise.all([
      listFreeModels().catch(() => []),
      prefsFor(userId).catch(() => ({})),
    ]);
    // The account preference must reach the shared platform-key path too. BYOK
    // routing already reads it through providerGateway; without this bridge a
    // user who had no connected key saw the saved model in Settings but the
    // next request silently reverted to task-tier order.
    const candidates = pickCandidates(models, tier, 3, accountPrefs.defaultModel);
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
        send({
          meta: {
            model: cand.id, tier, provider: PROVIDER_LABEL,
            demo: PROVIDER_LABEL !== 'openrouter',
            // If the user's own provider was tried and failed, the reply is
            // coming from MetaIoid's shared tier instead — say so. Silently
            // swapping in a platform key hides a broken BYOK credential
            // forever and presents someone else's quota as the user's own.
            ...(byokError ? { byok: false, notice: 'byok_failed', notice_code: providerCodeOf(byokError) } : {}),
          },
        });
        await streamChat({
          apiKey: OR_KEY, model: cand, messages, system,
          signal: controller.signal,
          onToken: (full) => send({ token: full }),
        });
        streamed = true;
        break;
      } catch (e) {
        lastErr = e;
        // A dead slug surfaces as 400/404 as often as 404, so anything
        // model-specific is quarantined and the next candidate is tried —
        // the user never sees the provider's raw complaint.
        if (modelSpecificFailure(e)) markModelDead(cand.id, (e && e.providerBody) || (e && e.message));
        if (!retryableProviderError(e)) throw e;
        console.warn(`[gateway] model ${cand.id} rejected (${(e && e.status) || 'net'}) \u2192 next candidate`);
        send({ retry: cand.id });
      }
    }
    if (!streamed) throw lastErr || new Error('openrouter failed');
    trackModel({ provider: usedProvider || PROVIDER_LABEL, model: usedModel, tier, ms: Date.now() - t0, ok: true });
    await countUsage();
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
        trackModel({ provider: usedProvider || PROVIDER_LABEL, model: usedModel, tier, ms: Date.now() - t0, ok: false });
        console.error('[gateway] all providers failed:', (e && e.message) || e, '|', (e2 && e2.message) || e2);
        send({ error: humanizeProviderError(e2.code === 'CLIENT_GONE' ? e2 : (e || e2)), code: providerCodeOf(e || e2) });
      }
    } else {
      trackModel({ provider: usedProvider || PROVIDER_LABEL, model: usedModel, tier, ms: Date.now() - t0, ok: false });
      if (!controller.signal.aborted && !(e && e.code === 'CLIENT_GONE')) {
        console.error('[gateway] chat failed:', (e && e.message) || e);
      }
      // If our own 50s budget aborted the upstream fetch, say so plainly
      // (retryable) instead of the generic provider text.
      if (controller.signal.aborted) {
        send({ error: 'The model took too long and was stopped. Try a shorter question or retry.', code: 'timeout' });
      } else {
        send({ error: humanizeProviderError(e), code: providerCodeOf(e) });
      }
    }
  } finally {
    clearTimeout(timer);
    stopHeartbeat();
    res.end();
  }
});

// ---- OSINT investigations (user-scoped) ----
app.post('/api/osint/investigations', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const v = validateTarget(req.body?.target);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const budget = await checkBudget(req.auth.userId, 'osint');
  if (!budget.ok) return res.status(429).json({ error: budget.error });
  const job = createInvestigation(v.target, v.type, req.auth.userId);
  await recordUsage(req.auth.userId, 'osint');
  res.status(201).json({ id: job.id, target: job.target, type: job.type, status: job.status });
});

app.get('/api/osint/investigations', requireAuth, (req, res) => {
  res.json({ investigations: listInvestigations(req.auth.userId) });
});

app.post('/api/osint/investigations/:id/run', requireAuth, rateLimit(5, 60000), (req, res) => {
  const job = getInvestigationFor(req.auth.userId, req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  const j = submitJob(req.auth.userId, 'osint', `investigate ${job.target}`, () => runInvestigation(job.id));
  res.status(202).json({ id: job.id, status: 'collecting', jobId: j.id });
});

app.get('/api/osint/investigations/:id', requireAuth, (req, res) => {
  const job = getInvestigationFor(req.auth.userId, req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  const { findings, ...rest } = job;
  res.json({ ...rest, counts: job.correlation, finding_count: findings.length });
});

app.get('/api/osint/investigations/:id/findings', requireAuth, (req, res) => {
  const job = getInvestigationFor(req.auth.userId, req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  let list = job.findings;
  if (req.query.type && req.query.type !== 'all') list = list.filter((f) => f.type === req.query.type);
  if (req.query.confidence && req.query.confidence !== 'all') list = list.filter((f) => f.confidence === req.query.confidence);
  res.json({ findings: list });
});

app.get('/api/osint/investigations/:id/report', requireAuth, (req, res) => {
  const job = getInvestigationFor(req.auth.userId, req.params.id);
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
// Merged view: code-defined system skills (global) + user packages (scoped).
// L1 metadata only — instructions/references load on explicit inspect (L2/L3).
function toolCoverage(declared = []) {
  const known = new Set(listTools().map((t) => t.name));
  return {
    known: declared.filter((t) => known.has(t)),
    // unknown = not in THIS gateway's tool catalog; plugins/providers resolve
    // via their own registries (Agent 2 ProviderRouter) — never faked here.
    unknown: declared.filter((t) => !known.has(t)),
  };
}
async function mergedSkills(userId, ctx = {}) {
  const sys = listSkills().map((s) => ({
    id: `sys-${s.id}`, name: s.name, description: s.description,
    version: s.version, author: 'Metaloid', userId: null,
    scope: 'global', source: 'system', status: 'enabled',
    types: ['agent'], capabilities: s.capabilities, tools: s.tools,
    triggers: [], createdAt: null, updatedAt: null, lastUsedAt: null,
  }));
  for (const s of listSkills()) await registerSystemSkill(s);
  const seen = new Set(sys.map((s) => s.id));
  return [...sys, ...(await listSkillCards(userId, ctx)).filter((s) => !seen.has(s.id))];
}
app.get('/api/skills', requireAuth, async (req, res) => res.json({
  skills: await mergedSkills(req.auth.userId, { workspaceId: req.query.workspaceId, projectId: req.query.projectId }),
}));
app.get('/api/skills/discover', requireAuth, (req, res) => {
  const ids = discoverSkills(String(req.query.q || ''));
  res.json({ skills: ids.map(skillBrief).filter(Boolean) });
});

// ================= UNIVERSAL SKILLS =================

// Discovery: task → ranked candidates (relevance + missing deps).
app.post('/api/skills/discover', requireAuth, rateLimit(30, 60000), async (req, res) => {
  const { task, workspaceId, projectId, projectSkills } = req.body || {};
  if (typeof task !== 'string' || !task.trim()) return res.status(400).json({ error: 'task required.' });
  res.json({
    candidates: await discoverFor(req.auth.userId, task, {
      workspaceId: workspaceId || undefined, projectId: projectId || undefined,
      projectSkills: Array.isArray(projectSkills) ? projectSkills : [],
    }),
  });
});

// Create from instructions (wizard) — same validation pipeline as import.
app.post('/api/skills', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const { name, description, instructions, types, triggers, tools, command, scope, workspaceId, projectId } = req.body || {};
  const v = validatePackage(packageFromFields({ name, description, instructions, types, triggers, tools, command }));
  if (!v.ok) return res.status(400).json({ error: v.errors.join(' '), warnings: v.warnings });
  const r = await installSkill(req.auth.userId, v.package, { scope: scope || 'user', workspaceId, projectId, source: 'created' });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json({ skill: r.skill, warnings: v.warnings });
});

// Import package {skill.md, files} — validated + scanned BEFORE install.
app.post('/api/skills/import', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const v = validatePackage(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors.join(' '), warnings: v.warnings, security: v.security });
  const { scope, workspaceId, projectId } = req.body || {};
  const r = await installSkill(req.auth.userId, v.package, { scope: scope || 'user', workspaceId, projectId, source: 'imported' });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json({ skill: r.skill, warnings: v.warnings });
});

// Validate-only (dry run for the upload UI + pre-install inspector).
app.post('/api/skills/validate', requireAuth, rateLimit(30, 60000), (req, res) => {
  const v = validatePackage(req.body || {});
  const p = v.package;
  res.json({
    ok: v.ok, errors: v.errors || [], warnings: v.warnings || [], security: v.security || null,
    manifest: p?.manifest || null,
    // pre-install inspection payload (nothing installed by this call)
    inspect: p ? {
      name: p.manifest.name, description: p.manifest.description, version: p.manifest.version,
      author: p.manifest.author, license: p.manifest.license,
      files: Object.keys(p.files || {}),
      scripts: Object.keys(p.scripts || {}),
      references: Object.keys(p.references || {}),
      tools: p.manifest.tools, plugins: p.manifest.dependencies.plugins,
      providers: p.manifest.dependencies.providers,
      permissions: p.manifest.permissions, dependencies: p.manifest.dependencies,
      toolCoverage: toolCoverage(p.manifest.tools || []),
    } : null,
  });
});

// Runtime adapters: what can execute here (JS live, others declared-unavailable).
// NOTE: registered BEFORE /:id — express matches in order, single-segment
// literal would otherwise be swallowed by the param route.
app.get('/api/skills/runtimes', requireAuth, (req, res) => {
  res.json({ runtimes: adapterStatus() });
});

app.get('/api/skills/:id', requireAuth, async (req, res) => {
  const s = await inspectSkill(req.auth.userId, req.params.id);
  if (!s) {
    // system skill? metadata-only card
    const sys = listSkills().find((x) => `sys-${x.id}` === req.params.id);
    if (sys) return res.json({ skill: { ...(skillBrief(sys.id) || {}), source: 'system', status: 'enabled', scope: 'global' } });
    return res.status(404).json({ error: 'Unknown skill.' });
  }
  res.json({ skill: s });
});

app.get('/api/skills/:id/file', requireAuth, async (req, res) => {
  const f = await readSkillFile(req.auth.userId, req.params.id, req.query.kind === 'script' ? 'script' : 'reference', String(req.query.name || ''));
  if (!f) return res.status(404).json({ error: 'Unknown skill or file.' });
  res.json(f);
});

app.put('/api/skills/:id', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const v = validatePackage(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors.join(' '), warnings: v.warnings, security: v.security });
  const r = await updateSkill(req.auth.userId, req.params.id, v.package, req.body?.note || '');
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json({ skill: r.skill, warnings: v.warnings });
});

app.post('/api/skills/:id/rollback/:version', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const r = await rollbackSkill(req.auth.userId, req.params.id, req.params.version);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json({ skill: r.skill });
});

app.post('/api/skills/:id/enable', requireAuth, async (req, res) => {
  const r = await setSkillStatus(req.auth.userId, req.params.id, true);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json({ skill: r.skill });
});

app.post('/api/skills/:id/disable', requireAuth, async (req, res) => {
  const r = await setSkillStatus(req.auth.userId, req.params.id, false);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json({ skill: r.skill });
});

app.post('/api/skills/:id/duplicate', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const r = await duplicateSkill(req.auth.userId, req.params.id);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.status(201).json({ skill: r.skill });
});

app.delete('/api/skills/:id', requireAuth, async (req, res) => {
  if (!(await deleteSkill(req.auth.userId, req.params.id))) return res.status(404).json({ error: 'Unknown skill.' });
  res.json({ ok: true });
});

// Test mode → PASS / FAIL / WARN.
app.post('/api/skills/:id/test', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const r = await testSkill(req.auth.userId, req.params.id, { input: req.body?.input || {} });
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json(r);
});

// Invoke: explicit (/command) or discovery-driven. Dep-checked, audited.
app.post('/api/skills/:id/invoke', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const r = await invokeSkill(req.auth.userId, req.params.id, {
    input: req.body?.input || {},
    available: req.body?.available || {},
    reason: req.body?.reason || '',
  });
  if (!r.ok && !r.missing) return res.status(404).json({ error: r.error });
  if (!r.ok) return res.status(409).json(r); // missing deps + hint
  res.json(r);
});

// Explicit /command invocation.
app.post('/api/skills/invoke-command', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const s = await findByCommand(req.auth.userId, req.body?.command);
  if (!s) return res.status(404).json({ error: 'Unknown skill command.' });
  const r = await invokeSkill(req.auth.userId, s.id, { input: req.body?.input || {}, available: req.body?.available || {}, reason: `/${s.command}` });
  if (!r.ok && !r.missing) return res.status(400).json({ error: r.error });
  if (!r.ok) return res.status(409).json(r);
  res.json(r);
});

app.get('/api/skills/:id/audit', requireAuth, async (req, res) => {
  const a = await skillAudit(req.auth.userId, req.params.id);
  if (!a) return res.status(404).json({ error: 'Unknown skill.' });
  res.json({ audit: a });
});

// Update diff: instructions/files/permissions/tools/deps changes between versions.
app.get('/api/skills/:id/diff', requireAuth, async (req, res) => {
  const d = await diffVersions(req.auth.userId, req.params.id, String(req.query.from || ''), req.query.to ? String(req.query.to) : null);
  if (!d) return res.status(404).json({ error: 'Unknown skill.' });
  if (d.ok === false) return res.status(404).json({ error: d.error });
  res.json(d);
});

// TaskEngine contract: schedules (no daemon yet — register now, fire explicitly).
app.get('/api/skill-schedules', requireAuth, (req, res) => {
  res.json({ schedules: listSchedules(req.auth.userId) });
});
app.post('/api/skill-schedules', requireAuth, rateLimit(10, 60000), (req, res) => {
  const r = registerSchedule(req.auth.userId, req.body || {});
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json({ schedule: r.schedule, note: 'Registered. No scheduler daemon runs yet — fire via run-now or a future TaskEngine.' });
});
app.post('/api/skill-schedules/:id/run', requireAuth, rateLimit(5, 60000), (req, res) => {
  Promise.resolve(runScheduled({ invokeSkill, checkBudget }, req.auth.userId, req.params.id))
    .then((r) => {
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json(r);
    })
    .catch(() => res.status(500).json({ error: 'Schedule run failed.' }));
});
app.delete('/api/skill-schedules/:id', requireAuth, (req, res) => {
  if (!removeSchedule(req.auth.userId, req.params.id)) return res.status(404).json({ error: 'Unknown schedule.' });
  res.json({ ok: true });
});

// ================= BACKGROUND JOBS (bounded queue) =================

app.get('/api/jobs', requireAuth, (req, res) => {
  const all = listJobs(req.auth.userId);
  const page = paginate(all, req, 50);
  res.json({ jobs: page.items, ...(page.paged ? { total: page.total, limit: page.limit, offset: page.offset } : {}), queue: queueStats() });
});

app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const j = getJob(req.auth.userId, req.params.id);
  if (!j) return res.status(404).json({ error: 'Unknown job.' });
  res.json({ job: j });
});

// ================= ARTIFACTS (user-scoped real files) =================

app.get('/api/artifacts', optionalAuth, (req, res) => {
  const all = listArtifacts(req.auth.userId, {
    projectId: req.query.projectId || undefined,
    workspaceId: req.query.workspaceId || undefined,
  });
  const page = paginate(all, req);
  res.json({ artifacts: page.items, ...(page.paged ? { total: page.total, limit: page.limit, offset: page.offset } : {}) });
});

app.post('/api/artifacts', optionalAuth, rateLimit(10, 60000), (req, res) => {
  const { kind, name, spec, projectId, workspaceId, taskId, conversationId } = req.body || {};
  const r = createArtifact({ userId: req.auth.userId, kind, name, spec, projectId, workspaceId, taskId, conversationId });
  if (!r.ok) return res.status(400).json({ error: r.error, artifact: r.artifact || null });
  res.status(201).json({ artifact: r.artifact });
});

app.get('/api/artifacts/:id', optionalAuth, (req, res) => {
  const a = getArtifact(req.auth.userId, req.params.id);
  if (!a) return res.status(404).json({ error: 'Unknown artifact.' });
  res.json({ artifact: { ...a, downloadUrl: `/api/artifacts/${a.id}/download` } });
});

app.get('/api/artifacts/:id/download', optionalAuth, (req, res) => {
  const r = downloadArtifact(req.auth.userId, req.params.id);
  if (!r) return res.status(404).json({ error: 'Unknown artifact.' });
  res.setHeader('Content-Type', MIME[r.artifact.kind] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${r.artifact.name.replace(/"/g, '')}"`);
  res.send(r.bytes);
});

app.post('/api/artifacts/:id/validate', optionalAuth, rateLimit(20, 60000), (req, res) => {
  const r = validateArtifact(req.auth.userId, req.params.id);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json({ verification: r.verification });
});

app.post('/api/artifacts/:id/render', optionalAuth, rateLimit(10, 60000), async (req, res) => {
  const r = await renderArtifact(req.auth.userId, req.params.id);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json(r);
});

app.get('/api/artifacts/renderer/status', requireAuth, async (req, res) => {
  res.json(await detectRenderer());
});

app.post('/api/artifacts/:id/qa', requireAuth, rateLimit(20, 60000), (req, res) => {
  const r = visualQA(req.auth.userId, req.params.id);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json(r);
});

app.post('/api/artifacts/:id/repair', requireAuth, rateLimit(10, 60000), (req, res) => {
  const r = repairArtifact(req.auth.userId, req.params.id);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(r);
});

app.post('/api/artifacts/:id/finalize', requireAuth, rateLimit(20, 60000), (req, res) => {
  const r = finalizeArtifact(req.auth.userId, req.params.id, req.body?.projectId || null);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ artifact: r.artifact });
});

app.put('/api/artifacts/:id', requireAuth, rateLimit(20, 60000), (req, res) => {
  const r = editArtifact(req.auth.userId, req.params.id, req.body?.spec, req.body?.note || '');
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ artifact: r.artifact });
});

app.post('/api/artifacts/:id/edit-slide', requireAuth, rateLimit(20, 60000), (req, res) => {
  const r = editSlide(req.auth.userId, req.params.id, req.body?.slide, { title: req.body?.title, bullets: req.body?.bullets });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ artifact: r.artifact });
});

app.delete('/api/artifacts/:id', requireAuth, (req, res) => {
  if (!deleteArtifact(req.auth.userId, req.params.id)) return res.status(404).json({ error: 'Unknown artifact.' });
  res.json({ ok: true });
});

// ---- agent artifact pipeline: skill → tools → real file → validate →
// render → QA → repair → finalize. Streams activity events, never fake ones.
app.post('/api/agent/artifact', requireAuth, rateLimit(10, 60000), async (req, res) => {
  let { kind, topic, slides, slidesCount, detail, projectId, conversationId } = req.body || {};
  const resolution = resolveIntentCapability(String(req.body?.requestText || ''));
  if (!kind && resolution.kind === 'artifact') kind = resolution.artifactKind;
  if (!topic && resolution.topic) topic = resolution.topic;
  if (!slidesCount && resolution.count) slidesCount = resolution.count;
  if (!['pptx', 'docx'].includes(kind)) {
    const message = resolution.kind === 'unavailable_artifact'
      ? `${resolution.format} is understood, but no verified ${resolution.format} writer is installed.`
      : 'No verified artifact format could be resolved. Supported writers: PPTX and DOCX.';
    return res.status(400).json({ error: message, resolution });
  }
  const cleanTopic = String(topic || '').trim().slice(0, 150);
  if (!cleanTopic && !slides) return res.status(400).json({ error: 'topic or explicit slides required.' });

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch { /* client gone */ }
  };
  const act = (phase, status, label, detailText = '') =>
    send({ activity: { taskId: `art-${Date.now().toString(36)}`, timestamp: Date.now(), phase, status, label, detail: detailText } });
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  let artifactId = null;

  try {
    act('UNDERSTAND', 'running', `Understanding request: ${kind.toUpperCase()} about ${cleanTopic.slice(0, 60)}`, resolution.reason || 'explicit artifact request');
    const n = Math.min(Math.max(Number(slidesCount) || 8, 3), 15);
    act('PLAN', 'done', `Planning ${kind === 'pptx' ? `${n}-slide deck` : 'document'}`, `${n} sections, school-friendly structure`);
    if (controller.signal.aborted) throw Object.assign(new Error('Stopped by user.'), { code: 'ABORTED' });

    // gather content: explicit slides (tests/deterministic) or model outline
    let deckSlides = Array.isArray(slides) ? slides : null;
    let docBlocks = null;
    if (!deckSlides && kind === 'docx' && Array.isArray(req.body?.blocks)) {
      docBlocks = req.body.blocks;
    }
    if (!deckSlides && !docBlocks) {
      act('RETRIEVE', 'running', 'Gathering content', 'drafting outline with the model');
      if (!OR_KEY) throw new Error('Model provider not configured — outline drafting unavailable.');
      const models = await import('./openrouter.js').then((m) => m.listFreeModels().catch(() => []));
      const model = (await import('./openrouter.js').then((m) => m.pickModel(models, 'smart')));
      const schema = kind === 'pptx'
        ? `JSON: {"slides":[{"title":"...","bullets":["..."]}]} — exactly ${n} slides, ≤5 bullets each, concise school-friendly wording.`
        : `JSON: {"blocks":[{"h":1,"text":"..."},{"p":"..."},{"bullets":["..."]}]} — headings, paragraphs, bullet lists.`;
      const { text } = await orComplete({
        apiKey: OR_KEY, model,
        system: 'You draft factual, neutral content outlines. Reply with ONLY the requested JSON, no markdown fences.',
        messages: [{ role: 'user', content: `Outline for a ${kind} about "${cleanTopic}". ${detail ? 'Focus: ' + String(detail).slice(0, 300) : ''} ${schema}` }],
      });
      let parsed = null;
      try {
        parsed = JSON.parse(text.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/)?.[0] || 'null');
      } catch { /* fall through */ }
      if (kind === 'pptx' && (!parsed || !Array.isArray(parsed.slides) || !parsed.slides.length)) {
        throw new Error('Outline drafting failed — the model did not return usable slides. Try again or provide an outline.');
      }
      if (kind === 'docx' && (!parsed || !Array.isArray(parsed.blocks) || !parsed.blocks.length)) {
        throw new Error('Outline drafting failed — the model did not return usable sections. Try again.');
      }
      if (kind === 'pptx') deckSlides = parsed.slides.slice(0, n);
      else docBlocks = parsed.blocks;
      act('RETRIEVE', 'done', 'Content gathered', `${kind === 'pptx' ? deckSlides.length + ' slides' : docBlocks.length + ' sections'} drafted`);
    } else {
      act('RETRIEVE', 'done', 'Content provided', 'using explicit outline');
    }
    if (controller.signal.aborted) throw Object.assign(new Error('Stopped by user.'), { code: 'ABORTED' });

    act('EXECUTE', 'running', kind === 'pptx' ? 'Creating slides' : 'Writing document', 'presentation.create / document.create');
    const spec = kind === 'pptx'
      ? { title: cleanTopic, slides: deckSlides, accent: '1F6B3A' }
      : { title: cleanTopic, blocks: docBlocks };
    const created = createArtifact({
      userId: req.auth.userId, kind, name: cleanTopic, spec,
      projectId: projectId || null, conversationId: conversationId || null, taskId: `agent-${Date.now().toString(36)}`,
    });
    if (!created.ok) throw new Error(created.error);
    const id = created.artifact.id;
    artifactId = id;
    act('EXECUTE', 'done', 'File built', `${created.artifact.name} (${(created.artifact.versions?.[0]?.bytes || 0)} bytes)`);

    act('CHECK', 'running', `Opening generated ${kind === 'pptx' ? 'PowerPoint package' : 'Word document'}`, 'reading ZIP directory, XML parts, and relationships');
    const v = validateArtifact(req.auth.userId, id);
    if (!v.ok) throw new Error(v.error);
    if (!v.verification.passed) {
      act('CHECK', 'error', 'Validation failed', v.verification.issues.join('; '));
      send({ done: false, error: 'Validation failed: ' + v.verification.issues.join('; '), artifact: v.artifact });
      res.end();
      return;
    }
    act('CHECK', 'done', 'Reopened and structurally validated', v.verification.checks.join(', '));

    const r = await renderArtifact(req.auth.userId, id);
    if (r.rendered) {
      act('CHECK', 'done', 'Rendered for visual review', `${r.previews} page previews`);
    } else {
      act('CHECK', 'done', 'Render skipped', r.message);
    }

    let qa = visualQA(req.auth.userId, id);
    if (qa.ok && !qa.allPassed && kind === 'pptx') {
      act('REPAIR', 'running', `Fixing ${qa.issues.length} layout issue(s)`, qa.issues[0]?.reason || '');
      const rep = repairArtifact(req.auth.userId, id);
      if (rep.ok) {
        act('REPAIR', 'done', 'Repaired and re-validated', `v${rep.artifact.version}`);
        qa = visualQA(req.auth.userId, id);
      } else {
        act('REPAIR', 'error', 'Repair unavailable', rep.error);
        throw new Error(`Presentation could not be verified after layout checks: ${rep.error}`);
      }
    }

    if (!qa.ok || !qa.allPassed) {
      const reasons = qa.issues?.map((x) => x.reason).join('; ') || 'visual/structural quality checks did not pass';
      act('CHECK', 'error', 'Verification did not pass', reasons);
      throw new Error(`Artifact was not finalized because verification did not pass: ${reasons}`);
    }

    const f = finalizeArtifact(req.auth.userId, id, projectId || null);
    if (!f.ok) throw new Error(f.error);
    act('FINALIZE', 'done', `${kind.toUpperCase()} created and verified`, f.artifact.name);
    send({ done: true, artifact: f.artifact });
  } catch (e) {
    if (e && e.code === 'ABORTED') {
      send({ activity: { taskId: 'art', timestamp: Date.now(), phase: 'FINALIZE', status: 'error', label: 'Stopped by user', detail: '' } });
      send({ done: false, error: 'Stopped by user.' });
    } else {
      const msg = String((e && e.message) || e).slice(0, 220);
      if (artifactId) failArtifact(req.auth.userId, artifactId, msg);
      send({ activity: { taskId: 'art', timestamp: Date.now(), phase: 'CHECK', status: 'error', label: 'Failed', detail: msg } });
      send({ done: false, error: msg });
    }
  } finally {
    res.end();
  }
});

// Tools (metadata only — execution goes through missions with permission gates)
app.get('/api/tools', requireAuth, (req, res) => res.json({ tools: listTools() }));
app.get('/api/tools/discover', requireAuth, (req, res) => res.json({ tools: discoverTools(String(req.query.q || '')) }));

// Approvals (permission engine queue — own approvals only)
app.get('/api/approvals', requireAuth, (req, res) => res.json({ pending: pendingApprovals(req.auth.userId) }));
app.post('/api/approvals/:id', requireAuth, rateLimit(20, 60000), (req, res) => {
  const a = grantApproval(req.params.id, req.body?.approved === true, req.auth.userId, req.auth.userId);
  if (!a) return res.status(404).json({ error: 'Unknown or decided approval.' });
  res.json({ approval: a });
});

// Missions (user-scoped, metered)
app.post('/api/missions', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const { objective, constraints, skillIds } = req.body || {};
  if (typeof objective !== 'string' || !objective.trim()) return res.status(400).json({ error: 'Objective required.' });
  const budget = await checkBudget(req.auth.userId, 'missions');
  if (!budget.ok) return res.status(429).json({ error: budget.error });
  const caps = planCaps(req.auth.userId);
  const codeSkills = Array.isArray(skillIds) && skillIds.length ? skillIds : discoverSkills(objective);
  // user-skill discovery: project/user packages join code skills in planning
    const discovered = (await discoverFor(req.auth.userId, objective, { workspaceId: req.body?.workspaceId, projectId: req.body?.projectId })).map((c) => c.skillId);
  const allSkills = [...codeSkills, ...discovered.filter((id) => !codeSkills.includes(id))].slice(0, 8);
  const tasks = planMission(objective, codeSkills);
  // `createMission` is async — it writes the mission through the data layer.
  // Without the await this returned a Promise, which serialised to `{}`, so
  // every created mission came back as an empty object with a 201.
  const m = await createMission({
    userId: req.auth.userId, objective, constraints, tasks, skillIds: allSkills,
    budgets: { maxMs: caps.maxMissionMs, maxSteps: caps.maxMissionSteps },
  });
  await recordUsage(req.auth.userId, 'missions');
  res.status(201).json({ mission: m });
});
app.get('/api/missions', requireAuth, async (req, res) => {
  const page = paginate(await listMissions(req.auth.userId), req);
  res.json({ missions: page.items, ...(page.paged ? { total: page.total, limit: page.limit, offset: page.offset } : {}) });
});
app.get('/api/missions/active', requireAuth, async (req, res) => {
  res.json({ mission: await latestActive(req.auth.userId) });
});
app.get('/api/missions/:id', requireAuth, async (req, res) => {
  const m = await getMission(req.auth.userId, req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown mission.' });
  res.json({ mission: m });
});
app.post('/api/missions/:id/run', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const m = await getMission(req.auth.userId, req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown mission.' });
  const j = submitJob(req.auth.userId, 'mission', m.objective, () => runMission(req.auth.userId, m.id, { userId: req.auth.userId }));
  res.status(202).json({ id: m.id, status: 'RUNNING', jobId: j.id });
});
app.post('/api/missions/:id/pause', requireAuth, async (req, res) => {
  const m = await pauseMission(req.auth.userId, req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown mission.' });
  res.json({ mission: m });
});
app.post('/api/missions/:id/cancel', requireAuth, async (req, res) => {
  const m = await cancelMission(req.auth.userId, req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown mission.' });
  res.json({ mission: m });
});
app.post('/api/missions/:id/verify', requireAuth, async (req, res) => {
  const m = await markVerified(req.auth.userId, req.params.id, req.body?.note || '');
  if (!m) return res.status(404).json({ error: 'Only COMPLETED missions can be verified.' });
  res.json({ mission: m });
});

// Agent: natural-language mission ops (continue / criticize / intent)
app.post('/api/agent/mission', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const { objective, constraints } = req.body || {};
  if (typeof objective !== 'string' || !objective.trim()) return res.status(400).json({ error: 'Objective required.' });
  const budget = await checkBudget(req.auth.userId, 'missions');
  if (!budget.ok) return res.status(429).json({ error: budget.error });
  const models = await listFreeModels().catch(() => []);
  const model = pickModel(models, 'smart');
  const profile = await getProfile(req.auth.userId);
  const m = await startMission({ userId: req.auth.userId, objective, constraints, apiKey: OR_KEY, model, userName: profile.displayName });
  await recordUsage(req.auth.userId, 'missions');
  res.status(201).json({ mission: m.mission, jobId: m.jobId });
});
app.post('/api/agent/continue', requireAuth, rateLimit(10, 60000), async (req, res) => {
  res.json(await continueMission(req.auth.userId));
});
app.post('/api/agent/criticize', requireAuth, rateLimit(20, 60000), async (req, res) => {
  res.json(await criticize(req.body?.draft ?? ''));
});
app.get('/api/agent/intent', requireAuth, (req, res) => {
  const q = String(req.query.q || '');
  res.json({ ...classifyIntent(q), resolution: resolveIntentCapability(q), catalog: capabilityCatalog });
});

// Memory (user-scoped; full user control: view/edit/delete/forget-all/export)
app.post('/api/memory', requireAuth, rateLimit(30, 60000), async (req, res) => {
  const r = await remember({ userId: req.auth.userId, cls: req.body?.class, content: req.body?.content, source: 'api', confidence: req.body?.confidence, workspaceId: req.body?.workspaceId });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json({ record: r.record });
});
app.get('/api/memory', requireAuth, async (req, res) => {
  const all = await recall(req.auth.userId, { cls: req.query.class, query: String(req.query.q || ''), workspaceId: req.query.workspaceId });
  const page = paginate(all, req);
  res.json({
    records: page.items,
    ...(page.paged ? { total: page.total, limit: page.limit, offset: page.offset } : {}),
    stats: await memoryStats(req.auth.userId),
  });
});
app.put('/api/memory/:id', requireAuth, rateLimit(30, 60000), async (req, res) => {
  const r = await updateMemory(req.auth.userId, req.params.id, { content: req.body?.content, confidence: req.body?.confidence });
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json({ record: r.record });
});
app.delete('/api/memory/:id', requireAuth, async (req, res) => {
  const r = await forget(req.auth.userId, req.params.id);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.json({ ok: true });
});
/** Forget everything this user is remembered as. */
app.delete('/api/memory', requireAuth, async (req, res) => {
  if (req.body?.all !== true) return res.status(400).json({ error: 'Pass {all:true} to forget everything.' });
  res.json(await forgetAll(req.auth.userId));
});

// World model (user-scoped knowledge graph)
app.post('/api/world/entities', requireAuth, rateLimit(30, 60000), async (req, res) => {
  const { type, name, aliases } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'type + name required.' });
  res.status(201).json({ entity: await upsertEntity({ userId: req.auth.userId, type, name, aliases, source: 'api' }) });
});
app.get('/api/world/entities', requireAuth, async (req, res) => {
  res.json({ entities: await findEntities(req.auth.userId, String(req.query.q || ''), req.query.type) });
});
app.post('/api/world/relate', requireAuth, rateLimit(30, 60000), async (req, res) => {
  const r = await relate(req.auth.userId, req.body?.from, req.body?.to, req.body?.rel, { source: 'api', evidence: req.body?.evidence });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json({ edge: r.edge });
});
app.get('/api/world/graph', requireAuth, async (req, res) => {
  if (!req.query.id) return res.json({ stats: await worldStats(req.auth.userId) });
  res.json(await neighbors(req.auth.userId, String(req.query.id), Math.min(Number(req.query.depth || 1), 3)));
});
app.get('/api/world/resolve', requireAuth, (req, res) => {
  res.json({ level: resolveLevel(String(req.query.a || ''), String(req.query.b || '')) });
});

// Verification
app.post('/api/verify', requireAuth, rateLimit(30, 60000), async (req, res) => {
  res.json(await verify(req.body?.value ?? null, req.body?.checks || ['nonempty']));
});

// Research helpers (deterministic correlation)
app.post('/api/research/correlate', requireAuth, rateLimit(30, 60000), (req, res) => {
  res.json(correlateExtracts(req.body?.a || '', req.body?.b || ''));
});

// OSINT → world ingestion (own investigation only)
app.post('/api/osint/investigations/:id/ingest', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const job = getInvestigationFor(req.auth.userId, req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown investigation.' });
  res.json(await ingestFindings(req.auth.userId, job.target, job.findings));
});

// Observability (admin only — aggregates are not per-user safe to expose)
app.get('/api/debug/summary', requireAuth, requireAdmin, (req, res) => {
  res.json({ ...observeSummary(), audit: recentAudit(30) });
});

// ================= USER LAYER =================

// Profile + preferences (user-confirmed; inferred stays in memory w/ confidence)
app.get('/api/profile', requireAuth, async (req, res) => {
  res.json({ profile: await getProfile(req.auth.userId), plan: getPlan(req.auth.userId) });
});
app.put('/api/profile', requireAuth, rateLimit(30, 60000), async (req, res) => {
  res.json({ profile: await updateProfile(req.auth.userId, req.body || {}) });
});
/** Premium first-run: name, language, style, voice, proactivity. Nothing more. */
app.post('/api/onboarding', requireAuth, rateLimit(10, 60000), async (req, res) => {
  res.json({ profile: await completeOnboarding(req.auth.userId, req.body || {}) });
});

// Usage + entitlements (read-only for users)
app.get('/api/usage', requireAuth, async (req, res) => {
  res.json(await usageSummary(req.auth.userId));
});

// Workspaces (isolated contexts; no automatic cross-workspace leakage)
app.get('/api/workspaces', requireAuth, async (req, res) => {
  res.json({ workspaces: await listWorkspaces(req.auth.userId) });
});
app.post('/api/workspaces', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const r = await createWorkspace(req.auth.userId, req.body || {});
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json({ workspace: r.workspace });
});
app.put('/api/workspaces/:id', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const w = await updateWorkspace(req.auth.userId, req.params.id, req.body || {});
  if (!w) return res.status(404).json({ error: 'Unknown workspace.' });
  res.json({ workspace: w });
});
app.delete('/api/workspaces/:id', requireAuth, async (req, res) => {
  if (!(await deleteWorkspace(req.auth.userId, req.params.id))) return res.status(404).json({ error: 'Unknown workspace.' });
  res.json({ ok: true });
});

// Devices (explicit pairing; per-(user, device, capability) authorization)
app.get('/api/devices', requireAuth, async (req, res) => {
  res.json({ devices: await listDevices(req.auth.userId) });
});
app.post('/api/devices/pair', requireAuth, rateLimit(10, 60000), async (req, res) => {
  res.json(await requestPairing(req.auth.userId, req.body || {}));
});
app.post('/api/devices/confirm', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const r = await confirmPairing(req.auth.userId, req.body?.code, { deviceId: req.body?.deviceId });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ device: r.device });
});
app.delete('/api/devices/:id', requireAuth, async (req, res) => {
  if (!(await revokeDevice(req.auth.userId, req.params.id))) return res.status(404).json({ error: 'Unknown device.' });
  res.json({ ok: true });
});

// ============================================================
// PROVIDER PLATFORM - Provider Management Endpoints
// ============================================================

// Provider Registry
app.get('/api/providers', requireAuth, (req, res) => {
  const category = req.query.category;
  const withAdapters = new Set(supportedProviders());
  res.json({
    providers: listProviders(category).map((p) => ({ ...p, adapter: withAdapters.has(p.providerId) })),
  });
});

// NOTE: single-segment param route /:providerId lives at the END of this
// block — express matches in order and it would otherwise swallow
// /credentials, /health, /routing, /usage literals.

app.get('/api/providers/:providerId/models', requireAuth, (req, res) => {
  const models = getProviderModels(req.params.providerId);
  res.json({ models });
});

// Credential Management
app.post('/api/providers/credentials', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const { providerId, credential, metadata } = req.body || {};
  if (!providerId || !credential) {
    return res.status(400).json({ error: 'providerId and credential required.' });
  }

  try {
    const result = await storeUserCredential(req.auth.userId, providerId, credential, metadata);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/providers/credentials', requireAuth, async (req, res) => {
  const credentials = await listUserCredentialProviders(req.auth.userId);
  res.json({ credentials });
});

app.get('/api/providers/credentials/:credentialId', requireAuth, async (req, res) => {
  // Only return metadata, never the actual credential
  const credentials = await listUserCredentialProviders(req.auth.userId);
  const credential = credentials.find(c => c.id === req.params.credentialId);
  if (!credential) return res.status(404).json({ error: 'Credential not found.' });
  res.json({ credential });
});

app.post('/api/providers/credentials/:credentialId/test', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const credentials = await listUserCredentialProviders(req.auth.userId);
  const credential = credentials.find(c => c.id === req.params.credentialId);
  if (!credential) return res.status(404).json({ error: 'Credential not found.' });

  // REAL test: live health check through the provider's own adapter.
  // Result stored via setCredentialTestStatus; never echoes the secret.
  try {
    const adapter = getAdapter(credential.providerId);
    if (!adapter) return res.status(400).json({ error: 'No adapter installed for this provider yet.' });
    const h = await adapter.healthCheck(req.auth.userId);
    await setCredentialTestStatus(req.auth.userId, credential.providerId, h.status === 'healthy' ? 'valid' : 'invalid', {
      adapter: adapter.constructor.name,
      latencyMs: h.latency,
      status: h.status,
      timestamp: new Date().toISOString(),
    });
    recordProviderCall(credential.providerId, req.auth.userId, credential.id, h.status === 'healthy', h.latency, h.error || null);
    res.json({ ok: h.status === 'healthy', status: h.status, latencyMs: h.latency, error: h.error || null });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error).slice(0, 200) });
  }
});

app.put('/api/providers/credentials/:credentialId', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: 'credential required.' });
  }

  const credentials = await listUserCredentialProviders(req.auth.userId);
  const credRecord = credentials.find(c => c.id === req.params.credentialId);
  if (!credRecord) return res.status(404).json({ error: 'Credential not found.' });

  try {
    const result = await rotateUserCredentialById(req.auth.userId, req.params.credentialId, credential);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/providers/credentials/:credentialId', requireAuth, async (req, res) => {
  const credentials = await listUserCredentialProviders(req.auth.userId);
  const credRecord = credentials.find(c => c.id === req.params.credentialId);
  if (!credRecord) return res.status(404).json({ error: 'Credential not found.' });

  const result = await deleteUserCredential(req.auth.userId, credRecord.providerId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

app.get('/api/providers/credentials/:credentialId/audit', requireAuth, async (req, res) => {
  const credentials = await listUserCredentialProviders(req.auth.userId);
  const credRecord = credentials.find(c => c.id === req.params.credentialId);
  if (!credRecord) return res.status(404).json({ error: 'Credential not found.' });

  const auditLog = await getCredentialAuditLog(req.auth.userId, credRecord.providerId);
  res.json({ auditLog });
});

// Model Catalog
app.get('/api/models/catalog', requireAuth, (req, res) => {
  const criteria = {
    providerId: req.query.providerId,
    capability: req.query.capability,
    availability: req.query.availability,
    modality: req.query.modality
  };
  res.json({ models: listModels(criteria) });
});

app.get('/api/models/catalog/:providerId/:modelId', requireAuth, (req, res) => {
  const model = getModel(req.params.providerId, req.params.modelId);
  if (!model) return res.status(404).json({ error: 'Model not found.' });
  res.json({ model });
});

app.get('/api/models/stats', requireAuth, (req, res) => {
  res.json(getModelStats());
});

// Provider Health
app.get('/api/providers/health', requireAuth, (req, res) => {
  const healthManager = getHealthManager();
  const allHealth = healthManager.getAllHealthStatuses();
  res.json({ health: allHealth });
});

app.get('/api/providers/:providerId/health', requireAuth, (req, res) => {
  const health = getProviderHealth(req.params.providerId);
  res.json({ health });
});

app.get('/api/providers/health/user', requireAuth, (req, res) => {
  const healthManager = getHealthManager();
  const userHealth = healthManager.getUserHealthStatuses(req.auth.userId);
  res.json({ health: userHealth });
});

// Routing prefs: default provider, ordered fallbacks, favorite models.
// Normal users leave everything Auto; advanced users pin providers/models.
app.get('/api/providers/routing', requireAuth, async (req, res) => {
  const p = await getProfile(req.auth.userId);
  res.json({
    routing: {
      defaultProvider: p.defaultProvider || null,
      fallbackProviders: p.fallbackProviders || [],
      favoriteModels: p.favoriteModels || [],
      defaultModel: p.defaultModel || 'auto',
    },
  });
});

app.put('/api/providers/routing', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const { defaultProvider, fallbackProviders, favoriteModels, defaultModel } = req.body || {};
  if (defaultProvider !== undefined && defaultProvider !== null && !getProvider(defaultProvider)) {
    return res.status(400).json({ error: 'Unknown provider.' });
  }
  if (fallbackProviders !== undefined && !Array.isArray(fallbackProviders)) {
    return res.status(400).json({ error: 'fallbackProviders must be an array.' });
  }
  if (fallbackProviders && fallbackProviders.some((p) => !getProvider(p))) {
    return res.status(400).json({ error: 'Unknown provider in fallbacks.' });
  }
  const profile = await updateProfile(req.auth.userId, {
    ...(defaultProvider !== undefined ? { defaultProvider } : {}),
    ...(fallbackProviders !== undefined ? { fallbackProviders } : {}),
    ...(favoriteModels !== undefined ? { favoriteModels } : {}),
    ...(defaultModel !== undefined ? { defaultModel } : {}),
  });
  res.json({
    routing: {
      defaultProvider: profile.defaultProvider || null,
      fallbackProviders: profile.fallbackProviders || [],
      favoriteModels: profile.favoriteModels || [],
      defaultModel: profile.defaultModel || 'auto',
    },
  });
});

// Usage: adapter-reported tokens/latency/counts. Cost only when reported.
app.get('/api/providers/usage', requireAuth, (req, res) => {
  res.json({ usage: providerUsageSummary(req.auth.userId) });
});

// Catalog sync: live model list → registry → catalog. Search/filter next.
app.post('/api/providers/:providerId/models/refresh', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const manifest = getProvider(req.params.providerId);
  if (!manifest) return res.status(404).json({ error: 'Provider not found.' });
  const adapter = getAdapter(req.params.providerId);
  if (!adapter) return res.status(400).json({ error: 'No adapter installed for this provider yet.' });
  try {
    const models = await adapter.listModels(req.auth.userId);
    updateProvider(req.params.providerId, {
      models: models.map((m) => ({
        modelId: m.modelId,
        displayName: m.displayName || m.modelId,
        capabilities: Object.entries(m.capabilities || {}).filter(([, v]) => v).map(([k]) => k),
        contextLimit: m.contextLimit || null,
        streaming: m.streaming !== false,
        async: m.async || false,
        availability: m.availability || 'public',
      })),
    });
    syncModelsFromRegistry({ listProviders, getProviderModels });
    res.json({ ok: true, count: models.length, live: models.some((m) => m.live) });
  } catch (e) {
    res.status(400).json({ error: String((e && e.message) || e).slice(0, 200) });
  }
});

// Help: official key/docs URLs from the registry manifest. Never invented.
const KEY_URLS = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
  nvidia: 'https://build.nvidia.com/account/api-keys',
};
app.get('/api/providers/:providerId/help', requireAuth, (req, res) => {
  const manifest = getProvider(req.params.providerId);
  if (!manifest) return res.status(404).json({ error: 'Provider not found.' });
  res.json({
    providerId: manifest.providerId,
    name: manifest.name,
    keyUrl: KEY_URLS[manifest.providerId] || null,
    docsUrl: manifest.documentationUrl || null,
    pricingUrl: manifest.pricingUrl || null,
    steps: ['Open Get API key', 'Create a key', 'Paste it below', 'Press Test — ready when healthy'],
  });
});

// Single-segment detail route LAST (see note above).
app.get('/api/providers/:providerId', requireAuth, (req, res) => {
  const provider = getProvider(req.params.providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found.' });
  res.json({ provider });
});

// Account: export everything, then delete everything (documented cascade)
app.get('/api/account/export', requireAuth, async (req, res) => {
  const u = getUser(req.auth.userId);
  const { passHash, salt, ...pub } = u || {};
  void passHash; void salt;
  res.json({
    exportedAt: new Date().toISOString(),
    user: pub || null,
    profile: await getProfile(req.auth.userId),
    plan: getPlan(req.auth.userId),
    usage: await usageSummary(req.auth.userId),
    memories: await exportMemories(req.auth.userId),
    missions: await listMissions(req.auth.userId),
    investigations: listInvestigations(req.auth.userId),
    workspaces: await listWorkspaces(req.auth.userId),
    devices: await listDevices(req.auth.userId),
    sessions: listSessions(req.auth.userId),
  });
});
app.delete('/api/account', requireAuth, rateLimit(5, 60000), async (req, res) => {
  if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: 'Pass {confirm:"DELETE"} to delete the account.' });
  const uid = req.auth.userId;
  await deleteUserMemories(uid);
  deleteUserMissions(uid);
  deleteUserWorld(uid);
  deleteUserInvestigations(uid);
  deleteUserApprovals(uid);
  deleteUserSkills(uid);
  deleteUserSchedules(uid);
  deleteUserJobs(uid);
  deleteUserArtifacts(uid);
  try {
    await deleteUserCredentials(uid); // provider credentials (mode-aware)
  } catch { /* none stored */ }
  deleteProviderUsage(uid);
  await deleteUserWorkspaces(uid);
  await deleteUserDevices(uid);
  await deleteUsage(uid);
  await deleteProfile(uid);
  deleteUserCascade(uid);
  res.json({ ok: true, deleted: uid });
});

// ---- unmatched API routes answer in the API's own language ----
// Anything under /api that no route claimed is a 404 in JSON. Without this a
// typo in a client path falls through to whatever serves the app shell, and
// the client reports a JSON parse failure instead of a missing endpoint.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint.', code: 'not_found', path: req.path });
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
  // Always a real http.Server: an express app has no close(), and a gateway
  // that cannot drain on SIGTERM is killed mid-stream on every deploy.
  : http.createServer(app);

/**
 * Serverless hosts (Vercel) import this module and own the lifecycle: they
 * call the exported `app` per request and must never have a listening socket
 * created for them. A long-running process (local, Render, a container) is
 * the case that needs `listen`.
 */
export const SERVERLESS = Boolean(process.env.VERCEL) || process.env.METALOID_HEADLESS === '1';
export { app };
export { serve };

// Graceful shutdown: finish in-flight streams before dying, so a deploy never
// cuts a user mid-sentence.
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[gateway] ${sig} — draining connections`);
    serve.close(() => process.exit(0));
    serve.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

if (!SERVERLESS) serve.listen(PORT, BIND_HOST, () => {
  console.log(`metaloid-gateway ${tlsOn ? 'https' : 'http'}://${
    BIND_HOST === '0.0.0.0' ? '<lan-ip>' : BIND_HOST
  }:${PORT} (openrouter:${OR_KEY ? 'set' : 'missing'} nvidia:${NV_ON && NV_KEY ? 'enabled' : 'off'})`);
  if (BIND_HOST === '0.0.0.0') {
    console.log('WARNING: gateway is reachable on your LAN. Same-WiFi only; never expose this port to the internet (it fronts paid API keys).');
  }
});
