// Transport — the ONLY layer that touches the network.
// Online: real gateway (health, SSE chat on free models, OSINT jobs).
// Offline: honest local demo (labelled DEMO by callers, never as backend).

import { planResponse } from './mockAgent';
import { streamText } from './mockStreaming';
import type { ConnectionState } from './types';
import { authHeaders, throwIfAuth } from './auth';

// Explicit VITE_API_URL always wins. Otherwise: on localhost, talk to the
// local gateway directly; on any other host (tunnel / preview / reverse
// proxy) fall back to the page's OWN ORIGIN (relative URLs), so a proxied
// /api (see vite.config.ts) works without hardcoding a host the remote
// browser could never reach.
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i;
const onLocalhost =
  typeof window === 'undefined' || LOCAL_HOSTS.test(window.location.hostname);

// On localhost the fallback mirrors the dev server's proxy scheme. Without
// certs the gateway serves plain http, and defaulting to https meant the first
// call of every local session failed and only succeeded via the scheme-swap
// rescue below — a visible stall for a condition we can just read.
export const API_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ||
  (onLocalhost ? (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GATEWAY_TLS === 'true'
    ? 'https://127.0.0.1:8787'
    : 'http://127.0.0.1:8787' : '');

export interface ServiceHealth {
  server: boolean;
  ai: boolean;
  voice: boolean;
  vision: boolean;
  realtime: boolean;
  database: boolean;
  /** 'openrouter' (real) | 'local-mock' (dev/demo provider) | null (none). */
  provider?: string | null;
  /** True when a key exists but the provider is unreachable — never show ONLINE. */
  degraded?: boolean;
  models?: { free?: number; total?: number; catalogue?: boolean; at?: string | null };
}

export const allDown: ServiceHealth = {
  server: false, ai: false, voice: false, vision: false, realtime: false, database: false,
  provider: null, degraded: false,
};

// On a remote host a stored *loopback* URL (the default) can never work —
// the browser would call its own machine — so it degrades to a relative,
// same-origin base (proxied /api in dev/preview, see vite.config.ts).
function remoteSafe(configured: string): string {
  if (onLocalhost) return configured;
  const c = (configured || '').trim();
  if (!c) return '';
  try {
    return LOCAL_HOSTS.test(new URL(c).hostname) ? '' : c;
  } catch {
    return c;
  }
}

function rawBase(configured: string): string {
  const u = remoteSafe(configured).trim().replace(/\/$/, '');
  return u || API_URL;
}

function baseOf(configured: string): string {
  // resolved (proven working scheme) wins; otherwise the configured value
  return resolved || rawBase(configured);
}

// scheme-swap rescue: localhost gateways exist as http OR https depending
// on whether LAN certs were generated. Try the other scheme on failure so
// a stale stored URL (or fresh default) never strands the app offline.
let resolved: string | null = null;
function altOf(base: string): string | null {
  if (base.startsWith('http://127.0.0.1') || base.startsWith('http://localhost')) {
    return base.replace('http://', 'https://');
  }
  if (base.startsWith('https://127.0.0.1') || base.startsWith('https://localhost')) {
    return base.replace('https://', 'http://');
  }
  return null;
}

/**
 * Three distinct truths, never blurred:
 *   mock      — answers, but the provider self-identifies as a local mock
 *   degraded  — a key is configured, the provider is unreachable
 *   online    — real provider, reachable
 */
function stateOf(h: ServiceHealth): ConnectionState {
  if (!h.ai) return 'offline';
  if (h.provider === 'local-mock') return 'mock';
  if (h.degraded) return 'degraded';
  return 'online';
}

async function probeHealth(base: string): Promise<ServiceHealth | null> {
  try {
    const res = await probeWithColdRetry(`${base}/api/health`);
    if (!res || !res.ok) return null;
    const h = (await res.json()) as Partial<ServiceHealth>;
    return {
      server: !!h.server, ai: !!h.ai, voice: !!h.voice,
      vision: !!h.vision, realtime: !!h.realtime, database: !!h.database,
      provider: h.provider ?? null,
      degraded: !!h.degraded,
      models: h.models,
    };
  } catch {
    return null;
  }
}

async function fetchTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const c = new AbortController();
  const id = window.setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: c.signal });
  } finally {
    window.clearTimeout(id);
  }
}

/**
 * Health probe that survives a serverless cold start.
 *
 * First attempt is fast (4s): a warm gateway answers in milliseconds, and a
 * truly dead network fails even faster (refused/DNS — never retried). Only a
 * TIMEOUT earns one long second chance, because that signature means "the
 * server exists but is still booting" — Vercel cold boots of this gateway
 * take several seconds, and mistaking them for offline is exactly how users
 * ended up with demo replies while online.
 */
async function probeWithColdRetry(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetchTimeout(url, 4000, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      try {
        return await fetchTimeout(url, 15000, init);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Real probe. Empty backend + unreachable gateway => offline (demo). */
export async function checkBackend(configuredUrl: string): Promise<{ state: ConnectionState; health: ServiceHealth }> {
  // always re-probe the configured value first: the user may have changed
  // Backend URL mid-session, which invalidates any cached scheme
  const primary = rawBase(configuredUrl);
  const h1 = await probeHealth(primary);
  if (h1) {
    resolved = primary;
    return { state: stateOf(h1), health: h1 };
  }
  const alt = altOf(primary);
  if (alt) {
    const h2 = await probeHealth(alt);
    if (h2) {
      resolved = alt;
      return { state: stateOf(h2), health: h2 };
    }
  }
  return { state: 'offline', health: allDown };
}

export interface LiveModel {
  id: string;
  name: string;
  tier: string;
  /** Set by the gateway when a slug was rejected and is temporarily skipped. */
  unavailable?: boolean;
}

let modelCache: { at: number; base: string; models: LiveModel[] } | null = null;

export async function getModels(configuredUrl: string): Promise<LiveModel[] | null> {
  const base = baseOf(configuredUrl);
  if (modelCache && Date.now() - modelCache.at < 60000 && modelCache.base === base) return modelCache.models;
  try {
    const res = await fetchTimeout(`${base}/api/models`, 8000);
    if (!res.ok) return null;
    const j = (await res.json()) as { models: LiveModel[] };
    modelCache = { at: Date.now(), base, models: j.models || [] };
    return modelCache.models;
  } catch {
    return null;
  }
}

export interface StreamResult {
  text: string;
  detectedLang: string;
  demo: boolean;
  model?: string;
  tier?: string;
  provider?: string;
}

/**
 * Stream a completion.
 * - Gateway reachable: real SSE from free-model router. Throws on failure
 *   (caller shows an honest error — never silent demo).
 * - Unreachable: local demo engine, demo:true.
 */
export async function streamChat(
  prompt: string,
  opts: {
    configuredUrl: string;
    history: { role: string; content: string }[];
    task?: string;
    context?: {
      userName?: string;
      memories?: { category: string; content: string }[];
      preferences?: Record<string, string>;
    };
    signal?: AbortSignal;
  },
  onToken: (partial: string) => void
): Promise<StreamResult> {
  const plan = planResponse(prompt);
  // reachability with the same scheme fallback as checkBackend, so a stale
  // stored URL (http vs https) never silently forces demo mode
  const base = baseOf(opts.configuredUrl);

  let reachableBase: string | null = null;
  const h = await probeWithColdRetry(`${base}/api/health`);
  if (h && h.ok) reachableBase = base;
  if (!reachableBase) {
    const alt = altOf(base);
    if (alt) {
      const h2 = await probeWithColdRetry(`${alt}/api/health`);
      if (h2 && h2.ok) {
        reachableBase = alt;
        resolved = alt;
      }
    }
  }

  if (!reachableBase) {
    await streamText(plan.response, onToken, { signal: opts.signal });
    return { text: plan.response, detectedLang: plan.detectedLang, demo: true };
  }
  const baseUrl = reachableBase;

  // ---- real path: POST SSE ----
  // The gateway requires a Bearer session on /api/chat (except local-open
  // dev). Without the token every signed-in user got a 401 here and the LLM
  // never activated — this header is the fix.
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    signal: opts.signal,
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message: prompt, history: opts.history.slice(-10), task: opts.task, context: opts.context }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Gateway ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let meta: { model?: string; tier?: string; provider?: string; demo?: boolean } = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      let ev: {
        meta?: { model: string; tier: string; provider?: string; demo?: boolean };
        token?: string; done?: boolean; error?: string; code?: string;
      };
      try {
        ev = JSON.parse(s.slice(5).trim());
      } catch {
        continue; // partial chunk — wait for more
      }
      if (ev.error) {
        const err = new Error(ev.error) as Error & { code?: string };
        if (ev.code) err.code = ev.code;
        throw err;
      }
      if (ev.meta) meta = ev.meta;
      if (typeof ev.token === 'string') {
        full = ev.token;
        onToken(full);
      }
      if (ev.done) {
        reader.cancel().catch(() => {});
        return {
          text: full, detectedLang: plan.detectedLang,
          demo: !!meta.demo || meta.provider === 'local-mock',
          model: meta.model, tier: meta.tier, provider: meta.provider,
        };
      }
    }
  }
  if (!full) throw new Error('Empty response from gateway.');
  return {
    text: full, detectedLang: plan.detectedLang,
    demo: !!meta.demo || meta.provider === 'local-mock',
    model: meta.model, tier: meta.tier, provider: meta.provider,
  };
}

// ---------------- OSINT client ----------------

export interface OsintFinding {
  type: string;
  value: string;
  source: string;
  source_url?: string;
  confidence: 'high' | 'medium' | 'low';
  evidence?: string;
  first_seen?: string;
  also_seen_by?: string[];
}

export async function osintCreate(configuredUrl: string, target: string) {
  const res = await fetch(`${baseOf(configuredUrl)}/api/osint/investigations`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ target }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'Invalid target.');
  return j as { id: string; target: string; type: string; status: string };
}

export async function osintRun(configuredUrl: string, id: string) {
  const res = await fetch(`${baseOf(configuredUrl)}/api/osint/investigations/${id}/run`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error('Could not start investigation.');
}

export async function osintGet(configuredUrl: string, id: string) {
  const res = await fetch(`${baseOf(configuredUrl)}/api/osint/investigations/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Investigation not found.');
  return res.json() as Promise<{
    id: string; target: string; type: string; status: string; progress: number;
    collectors: { id: string; name: string; state: string }[];
    timeline: { at: string; event: string; detail: string }[];
    correlation: Record<string, { count: number }>;
    finding_count: number;
  }>;
}

export async function osintFindings(configuredUrl: string, id: string, type = 'all', confidence = 'all') {
  const res = await fetch(
    `${baseOf(configuredUrl)}/api/osint/investigations/${id}/findings?type=${type}&confidence=${confidence}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error('Findings unavailable.');
  const j = await res.json();
  return j.findings as OsintFinding[];
}

export function osintReportUrl(configuredUrl: string, id: string, format: 'json' | 'csv' | 'md') {
  return `${baseOf(configuredUrl)}/api/osint/investigations/${id}/report?format=${format}`;
}

// ---------------- Mission client (agent runtime) ----------------

export interface MissionTask {
  id: string; name: string; skill: string | null; tool: string | null;
  deps: string[]; status: string; attempts: number;
  result: unknown; error: string | null;
}

export interface Mission {
  id: string; objective: string; constraints: string[];
  status: string; tasks: MissionTask[];
  outputs: { report?: string; verification?: { passed: boolean } };
  decisions: string[]; errors: { task: string; error: string; approvalId?: string }[];
  timeline: { at: string; event: string; detail: string }[];
  createdAt: string;
}

async function missionReq(configuredUrl: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseOf(configuredUrl)}${path}`, {
    ...init,
    headers: authHeaders({ 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) || {}) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || `Mission API ${res.status}`);
  return j;
}

export async function missionCreate(configuredUrl: string, objective: string) {
  const j = await missionReq(configuredUrl, '/api/missions', { method: 'POST', body: JSON.stringify({ objective }) });
  return j.mission as Mission;
}

export async function agentMission(configuredUrl: string, objective: string) {
  const j = await missionReq(configuredUrl, '/api/agent/mission', { method: 'POST', body: JSON.stringify({ objective }) });
  return j.mission as Mission;
}

export async function missionRun(configuredUrl: string, id: string) {
  await missionReq(configuredUrl, `/api/missions/${id}/run`, { method: 'POST' });
}

export async function missionGet(configuredUrl: string, id: string) {
  const j = await missionReq(configuredUrl, `/api/missions/${id}`);
  return j.mission as Mission;
}

export async function missionList(configuredUrl: string) {
  const j = await missionReq(configuredUrl, '/api/missions');
  return j.missions as Mission[];
}

export async function missionPause(configuredUrl: string, id: string) {
  const j = await missionReq(configuredUrl, `/api/missions/${id}/pause`, { method: 'POST' });
  return j.mission as Mission;
}

export async function missionCancel(configuredUrl: string, id: string) {
  const j = await missionReq(configuredUrl, `/api/missions/${id}/cancel`, { method: 'POST' });
  return j.mission as Mission;
}

export async function agentContinue(configuredUrl: string) {
  const j = await missionReq(configuredUrl, '/api/agent/continue', { method: 'POST' });
  if (!j.ok && j.error) throw new Error(j.error);
  return j.mission as Mission | null;
}

export async function demoVision(hint: string): Promise<string> {
  const { analyzeImage } = await import('../providers/vision');
  return analyzeImage(hint);
}

// ═══════════════════════════════════════════════════════════════════════════
// Master-line API surface, merged in so the workspaces / skills / provider
// platform built on that branch stays reachable from the polished shell.
// Nothing here duplicates what is above: shared names (health, models, chat,
// OSINT, missions) keep the single implementation defined earlier in the file.
// ═══════════════════════════════════════════════════════════════════════════
export interface AuthResponse {
  access: string;
  refresh: string;
  user: { id: string; handle: string; displayName: string; role: string; createdAt: string };
  profile: Record<string, unknown>;
  session: { id: string };
}


export async function authSignup(configuredUrl: string, handle: string, displayName: string, passcode: string) {
  const j = await authReq(configuredUrl, '/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ handle, displayName, passcode }),
  });
  return j as AuthResponse;
}


export async function authLogin(configuredUrl: string, handle: string, passcode: string) {
  const j = await authReq(configuredUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ handle, passcode }),
  });
  return j as AuthResponse;
}


export async function authRefresh(configuredUrl: string, refresh: string) {
  const j = await authReq(configuredUrl, '/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh }),
  });
  return j as { access: string; refresh: string; session: { id: string } };
}


export async function authLogout(configuredUrl: string) {
  await authReq(configuredUrl, '/api/auth/logout', { method: 'POST' });
}


export async function fetchMe(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/auth/me');
  return j as { user: AuthResponse['user']; profile: Record<string, unknown>; usage: Record<string, unknown> };
}


export async function fetchProfile(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/profile');
  return j as { profile: Record<string, unknown>; plan: string };
}


export async function saveProfile(configuredUrl: string, patch: Record<string, unknown>) {
  const j = await authReq(configuredUrl, '/api/profile', { method: 'PUT', body: JSON.stringify(patch) });
  return (j as { profile: Record<string, unknown> }).profile;
}


export async function submitOnboarding(configuredUrl: string, answers: Record<string, unknown>) {
  const j = await authReq(configuredUrl, '/api/onboarding', { method: 'POST', body: JSON.stringify(answers) });
  return (j as { profile: Record<string, unknown> }).profile;
}


export async function fetchUsage(configuredUrl: string) {
  return authReq(configuredUrl, '/api/usage') as Promise<Record<string, unknown>>;
}


export async function exportAccount(configuredUrl: string) {
  return authReq(configuredUrl, '/api/account/export') as Promise<Record<string, unknown>>;
}


export async function deleteAccount(configuredUrl: string) {
  return authReq(configuredUrl, '/api/account', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) });
}


export async function forgetAllServerMemories(configuredUrl: string) {
  return authReq(configuredUrl, '/api/memory', { method: 'DELETE', body: JSON.stringify({ all: true }) });
}

// ---------------- Devices ----------------


export interface PairedDevice {
  id: string;
  name: string;
  capabilities: string[];
  pairedAt: string;
  lastSeenAt: string | null;
}


export async function fetchDevices(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/devices');
  return (j as { devices: PairedDevice[] }).devices;
}


export async function requestDevicePairing(configuredUrl: string, deviceName: string) {
  const j = await authReq(configuredUrl, '/api/devices/pair', {
    method: 'POST',
    body: JSON.stringify({ deviceName }),
  });
  return j as { code: string; expiresInSec: number };
}


export async function confirmDevicePairing(configuredUrl: string, code: string, deviceId: string) {
  const j = await authReq(configuredUrl, '/api/devices/confirm', {
    method: 'POST',
    body: JSON.stringify({ code, deviceId }),
  });
  return (j as { device: PairedDevice }).device;
}


export async function revokeDevice(configuredUrl: string, id: string) {
  await authReq(configuredUrl, `/api/devices/${id}`, { method: 'DELETE' });
}


export async function logoutEverywhere(configuredUrl: string) {
  return authReq(configuredUrl, '/api/auth/logout-all', { method: 'POST' });
}

// ---------------- Projects / workspaces ----------------


export interface Workspace {
  id: string;
  name: string;
  kind: string;
  instructions: string;
  files: { id: string; name: string; size: number; type: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}


export async function fetchWorkspaces(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/workspaces');
  return (j as { workspaces: Workspace[] }).workspaces;
}


export async function createWorkspace(configuredUrl: string, input: Pick<Workspace, 'name'> & Partial<Pick<Workspace, 'kind' | 'instructions'>>) {
  const j = await authReq(configuredUrl, '/api/workspaces', { method: 'POST', body: JSON.stringify(input) });
  return (j as { workspace: Workspace }).workspace;
}


export async function updateWorkspace(configuredUrl: string, id: string, patch: Partial<Pick<Workspace, 'name' | 'instructions'>>) {
  const j = await authReq(configuredUrl, `/api/workspaces/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  return (j as { workspace: Workspace }).workspace;
}


export async function deleteWorkspace(configuredUrl: string, id: string) {
  await authReq(configuredUrl, `/api/workspaces/${id}`, { method: 'DELETE' });
}

// ---------------- Universal Skills ----------------


export interface SkillCard {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  scope: string;
  source: string;
  status: string;
  types: string[];
  command: string | null;
  tools: string[];
  triggers: string[];
  createdAt: string | null;
  updatedAt: string | null;
  lastUsedAt: string | null;
}


export async function fetchSkills(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/skills');
  return (j as { skills: SkillCard[] }).skills;
}


export async function fetchSkill(configuredUrl: string, id: string) {
  const j = await authReq(configuredUrl, `/api/skills/${id}`);
  return (j as { skill: Record<string, unknown> }).skill;
}


export async function createSkill(configuredUrl: string, fields: Record<string, unknown>) {
  const j = await authReq(configuredUrl, '/api/skills', { method: 'POST', body: JSON.stringify(fields) });
  return j as { skill: SkillCard; warnings: string[] };
}


export async function importSkill(configuredUrl: string, pkg: Record<string, unknown>) {
  const j = await authReq(configuredUrl, '/api/skills/import', { method: 'POST', body: JSON.stringify(pkg) });
  return j as { skill: SkillCard; warnings: string[] };
}


export async function uploadSkillZip(configuredUrl: string, zipBase64: string, scope = 'user') {
  const j = await authReq(configuredUrl, '/api/skills/import', {
    method: 'POST',
    body: JSON.stringify({ zipBase64, scope }),
  });
  return j as { skill: SkillCard; warnings: string[] };
}


export interface SkillInspectPayload {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest: Record<string, unknown> | null;
  inspect: {
    name: string;
    description: string;
    version: string;
    author: string;
    license: string;
    files: string[];
    scripts: string[];
    references: string[];
    tools: string[];
    plugins: string[];
    providers: string[];
    permissions: Record<string, unknown>;
    dependencies: Record<string, string[]>;
    toolCoverage: { known: string[]; unknown: string[] };
  } | null;
  security: { risk: string; findings: { file: string; issue: string; level: string }[] } | null;
}


export async function validateSkill(configuredUrl: string, pkg: Record<string, unknown>) {
  return authReq(configuredUrl, '/api/skills/validate', { method: 'POST', body: JSON.stringify(pkg) }) as Promise<SkillInspectPayload>;
}


export async function updateSkill(configuredUrl: string, id: string, pkg: Record<string, unknown>, note = '') {
  const j = await authReq(configuredUrl, `/api/skills/${id}`, { method: 'PUT', body: JSON.stringify({ ...pkg, note }) });
  return j as { skill: SkillCard; warnings: string[] };
}


export async function rollbackSkill(configuredUrl: string, id: string, version: string) {
  const j = await authReq(configuredUrl, `/api/skills/${id}/rollback/${version}`, { method: 'POST' });
  return (j as { skill: SkillCard }).skill;
}


export async function setSkillEnabled(configuredUrl: string, id: string, enabled: boolean) {
  const j = await authReq(configuredUrl, `/api/skills/${id}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' });
  return (j as { skill: SkillCard }).skill;
}


export async function duplicateSkill(configuredUrl: string, id: string) {
  const j = await authReq(configuredUrl, `/api/skills/${id}/duplicate`, { method: 'POST' });
  return (j as { skill: SkillCard }).skill;
}


export async function deleteSkill(configuredUrl: string, id: string) {
  await authReq(configuredUrl, `/api/skills/${id}`, { method: 'DELETE' });
}


export async function testSkill(configuredUrl: string, id: string, input: Record<string, unknown> = {}) {
  const j = await authReq(configuredUrl, `/api/skills/${id}/test`, { method: 'POST', body: JSON.stringify({ input }) });
  return j as { verdict: string; checks: { name: string; verdict: string; detail: string }[] };
}


export async function invokeSkill(configuredUrl: string, id: string, input: Record<string, unknown> = {}, reason = '') {
  const { status, body } = await authReqRaw(configuredUrl, `/api/skills/${id}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ input, reason }),
  });
  if (status === 404) throw new SkillNotFoundError();
  if (status !== 200) throw new SkillInvokeError((body.error as string) || 'Skill invocation failed.', body);
  return body;
}


export async function invokeSkillCommand(configuredUrl: string, command: string, input: Record<string, unknown> = {}) {
  const { status, body } = await authReqRaw(configuredUrl, '/api/skills/invoke-command', {
    method: 'POST',
    body: JSON.stringify({ command, input }),
  });
  if (status === 404) throw new SkillNotFoundError();
  if (status !== 200) throw new SkillInvokeError((body.error as string) || 'Skill invocation failed.', body);
  return body;
}


export class SkillNotFoundError extends Error {
  constructor() {
    super('Unknown skill command.');
    this.name = 'SkillNotFoundError';
  }
}


export class SkillInvokeError extends Error {
  details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'SkillInvokeError';
    this.details = details;
  }
}

/** Authed fetch that returns status+body without throwing (for 404/409 flows). */
async function authReqRaw(configuredUrl: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseOf(configuredUrl)}${path}`, {
    ...init,
    headers: authHeaders({ 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) || {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throwIfAuth(res, body as { code?: string });
  return { status: res.status, body };
}


export interface SkillCandidate {
  skillId: string;
  name: string;
  score: number;
  hits: string[];
  auto: boolean;
  command: string | null;
}


export async function discoverSkills(configuredUrl: string, task: string) {
  const j = await authReq(configuredUrl, '/api/skills/discover', { method: 'POST', body: JSON.stringify({ task }) });
  return (j as { candidates: SkillCandidate[] }).candidates;
}


export async function fetchSkillAudit(configuredUrl: string, id: string) {
  const j = await authReq(configuredUrl, `/api/skills/${id}/audit`);
  return (j as { audit: { at: string; event: string; detail: string }[] }).audit;
}


export async function fetchSkillDiff(configuredUrl: string, id: string, from: string, to?: string) {
  const j = await authReq(configuredUrl, `/api/skills/${id}/diff?from=${encodeURIComponent(from)}${to ? `&to=${encodeURIComponent(to)}` : ''}`);
  return j as { ok: boolean; from: string; to: string; diff: Record<string, unknown>; legacy?: boolean };
}


export async function fetchSkillRuntimes(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/skills/runtimes');
  return (j as { runtimes: { kind: string; available: boolean; runs: string[]; note: string }[] }).runtimes;
}


export interface SkillSchedule {
  id: string;
  skillId: string;
  cadence: string;
  input: Record<string, unknown>;
  report: string;
  enabled: boolean;
  lastRunAt: string | null;
  runs: number;
}


export async function fetchSkillSchedules(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/skill-schedules');
  return (j as { schedules: SkillSchedule[] }).schedules;
}


export async function createSkillSchedule(configuredUrl: string, skillId: string, cadence: string) {
  const j = await authReq(configuredUrl, '/api/skill-schedules', { method: 'POST', body: JSON.stringify({ skillId, cadence }) });
  return j as { schedule: SkillSchedule; note: string };
}


export async function runSkillSchedule(configuredUrl: string, id: string) {
  return authReq(configuredUrl, `/api/skill-schedules/${id}/run`, { method: 'POST' });
}


export async function deleteSkillSchedule(configuredUrl: string, id: string) {
  await authReq(configuredUrl, `/api/skill-schedules/${id}`, { method: 'DELETE' });
}

// ---------------- Artifacts (real files) ----------------


export interface ArtifactMeta {
  id: string;
  name: string;
  kind: string;
  status: string;
  version: number;
  projectId: string | null;
  verification: { passed: boolean; checks: string[]; issues: string[] } | null;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
}


export interface ActivityWireEvent {
  taskId: string;
  timestamp: number;
  phase: 'UNDERSTAND' | 'PLAN' | 'RETRIEVE' | 'EXECUTE' | 'CHECK' | 'REPAIR' | 'FINALIZE';
  status: 'running' | 'done' | 'error';
  label: string;
  detail?: string;
}

/** Agent artifact pipeline over SSE: feeds server activity events + final artifact. */

export async function generateArtifact(
  configuredUrl: string,
  input: { kind?: 'pptx' | 'docx'; requestText?: string; topic?: string; slides?: unknown[]; blocks?: unknown[]; slidesCount?: number; detail?: string; projectId?: string; conversationId?: string },
  onActivity: (e: ActivityWireEvent) => void,
  signal?: AbortSignal
): Promise<{ ok: boolean; artifact?: ArtifactMeta; error?: string }> {
  const res = await fetch(`${baseOf(configuredUrl)}/api/agent/artifact`, {
    method: 'POST',
    signal,
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  if (res.status === 401) throwIfAuth(res, null);
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Artifact API ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let outcome: { ok: boolean; artifact?: ArtifactMeta; error?: string } = { ok: false, error: 'Empty response.' };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      let ev: { activity?: ActivityWireEvent; done?: boolean; artifact?: ArtifactMeta; error?: string };
      try {
        ev = JSON.parse(s.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.activity) onActivity(ev.activity);
      if (ev.done !== undefined) {
        outcome = ev.done
          ? { ok: true, artifact: ev.artifact }
          : { ok: false, error: ev.error || 'Artifact pipeline failed.' };
      }
    }
  }
  return outcome;
}


export async function fetchArtifacts(configuredUrl: string, projectId?: string) {
  const j = await authReq(configuredUrl, `/api/artifacts${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
  return (j as { artifacts: ArtifactMeta[] }).artifacts;
}


export async function validateArtifactApi(configuredUrl: string, id: string) {
  const j = await authReq(configuredUrl, `/api/artifacts/${id}/validate`, { method: 'POST' });
  return j as { verification: ArtifactMeta['verification'] };
}


export async function renderArtifactApi(configuredUrl: string, id: string) {
  const j = await authReq(configuredUrl, `/api/artifacts/${id}/render`, { method: 'POST' });
  return j as { rendered: boolean; message?: string; pdfBytes?: number; previews?: number; artifact: ArtifactMeta };
}


export async function finalizeArtifactApi(configuredUrl: string, id: string, projectId?: string) {
  const j = await authReq(configuredUrl, `/api/artifacts/${id}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ projectId: projectId || null }),
  });
  return (j as { artifact: ArtifactMeta }).artifact;
}


export async function editSlideApi(configuredUrl: string, id: string, slide: number, opts: { title?: string; bullets?: string[] }) {
  const j = await authReq(configuredUrl, `/api/artifacts/${id}/edit-slide`, {
    method: 'POST',
    body: JSON.stringify({ slide, ...opts }),
  });
  return (j as { artifact: ArtifactMeta }).artifact;
}

/** Download bytes with the session token (no token in URLs). */

export async function downloadArtifactBlob(configuredUrl: string, id: string): Promise<{ blob: Blob; name: string }> {
  const res = await fetch(`${baseOf(configuredUrl)}/api/artifacts/${id}/download`, { headers: authHeaders() });
  if (res.status === 401) throwIfAuth(res, null);
  if (!res.ok) throw new Error('Download failed.');
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const name = disp.match(/filename="([^"]+)"/)?.[1] || `${id}.bin`;
  return { blob, name };
}

// ---------------- AI Providers (BYOK) ----------------


export interface ProviderInfo {
  providerId: string;
  name: string;
  category: string;
  capabilities: { streaming: boolean; supportedModalities: string[] };
  modelCount: number;
  adapterVersion: string;
  documentationUrl: string;
  adapter: boolean;
}


export interface CredentialInfo {
  id: string;
  providerId: string;
  isActive: boolean;
  createdAt: string;
  redacted: string;
}


export async function fetchProviders(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/providers');
  return (j as { providers: ProviderInfo[] }).providers;
}


export async function fetchProviderModels(configuredUrl: string, providerId: string) {
  const j = await authReq(configuredUrl, `/api/providers/${providerId}/models`);
  return (j as { models: { modelId: string; displayName: string; capabilities: string[]; contextLimit: number | null }[] }).models;
}


export async function refreshProviderModels(configuredUrl: string, providerId: string) {
  const j = await authReq(configuredUrl, `/api/providers/${providerId}/models/refresh`, { method: 'POST' });
  return j as { ok: boolean; count: number; live: boolean };
}


export async function fetchProviderHelp(configuredUrl: string, providerId: string) {
  const j = await authReq(configuredUrl, `/api/providers/${providerId}/help`);
  return j as { providerId: string; name: string; keyUrl: string | null; docsUrl: string | null; pricingUrl: string | null; steps: string[] };
}


export async function fetchCredentials(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/providers/credentials');
  return (j as { credentials: CredentialInfo[] }).credentials;
}


export async function connectCredential(configuredUrl: string, providerId: string, credential: string) {
  const j = await authReq(configuredUrl, '/api/providers/credentials', {
    method: 'POST',
    body: JSON.stringify({ providerId, credential }),
  });
  return j as CredentialInfo;
}


export async function testCredential(configuredUrl: string, credentialId: string) {
  const j = await authReq(configuredUrl, `/api/providers/credentials/${credentialId}/test`, { method: 'POST' });
  return j as { ok: boolean; status: string; latencyMs: number; error: string | null };
}


export async function rotateCredential(configuredUrl: string, credentialId: string, credential: string) {
  const j = await authReq(configuredUrl, `/api/providers/credentials/${credentialId}`, {
    method: 'PUT',
    body: JSON.stringify({ credential }),
  });
  return j;
}


export async function disconnectCredential(configuredUrl: string, credentialId: string) {
  await authReq(configuredUrl, `/api/providers/credentials/${credentialId}`, { method: 'DELETE' });
}


export interface RoutingPrefs {
  defaultProvider: string | null;
  fallbackProviders: string[];
  favoriteModels: string[];
  defaultModel: string;
}


export async function fetchRouting(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/providers/routing');
  return (j as { routing: RoutingPrefs }).routing;
}


export async function saveRouting(configuredUrl: string, patch: Partial<RoutingPrefs>) {
  const j = await authReq(configuredUrl, '/api/providers/routing', { method: 'PUT', body: JSON.stringify(patch) });
  return (j as { routing: RoutingPrefs }).routing;
}


export async function fetchProviderHealth(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/providers/health/user');
  return (j as { health: Record<string, { status: string; latency?: number; lastChecked?: string }> }).health;
}


export async function fetchProviderUsage(configuredUrl: string) {
  const j = await authReq(configuredUrl, '/api/providers/usage');
  return (j as {
    usage: Record<string, {
      requests: number; errors: number; promptTokens: number; completionTokens: number;
      totalTokens: number; avgLatencyMs: number; lastAt: string | null;
      cost: { usd: number | null; source: string };
    }>;
  }).usage;
}


export async function fetchModelCatalog(configuredUrl: string, providerId?: string) {
  const j = await authReq(configuredUrl, `/api/models/catalog${providerId ? `?providerId=${providerId}` : ''}`);
  return (j as { models: { providerId: string; modelId: string; displayName: string; capabilities: Record<string, boolean> }[] }).models;
}

/** Authenticated JSON request: bearer token from the single identity module,
 *  a 401 clears the session and raises AUTH_REQUIRED for the UI. */
async function authReq(configuredUrl: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseOf(configuredUrl)}${path}`, {
    ...init,
    headers: authHeaders({ 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) || {}) }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) throwIfAuth(res, j as { code?: string });
  if (!res.ok) throw new Error((j as { error?: string }).error || `Request failed (${res.status})`);
  return j;
}
