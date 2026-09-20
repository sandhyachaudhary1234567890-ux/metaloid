// Transport — the ONLY layer that touches the network.
// Online: real gateway (health, SSE chat on free models, OSINT jobs).
// Offline: honest local demo (labelled DEMO by callers, never as backend).

import { planResponse } from './mockAgent';
import { streamText } from './mockStreaming';
import type { ConnectionState } from './types';

export const API_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ||
  'https://127.0.0.1:8787';

export interface ServiceHealth {
  server: boolean;
  ai: boolean;
  voice: boolean;
  vision: boolean;
  realtime: boolean;
  database: boolean;
}

export const allDown: ServiceHealth = {
  server: false, ai: false, voice: false, vision: false, realtime: false, database: false,
};

function rawBase(configured: string): string {
  const u = (configured || '').trim().replace(/\/$/, '');
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

async function probeHealth(base: string): Promise<ServiceHealth | null> {
  try {
    const res = await fetchTimeout(`${base}/api/health`, 5000);
    if (!res.ok) return null;
    const h = (await res.json()) as Partial<ServiceHealth>;
    return {
      server: !!h.server, ai: !!h.ai, voice: !!h.voice,
      vision: !!h.vision, realtime: !!h.realtime, database: !!h.database,
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

/** Real probe. Empty backend + unreachable gateway => offline (demo). */
export async function checkBackend(configuredUrl: string): Promise<{ state: ConnectionState; health: ServiceHealth }> {
  // always re-probe the configured value first: the user may have changed
  // Backend URL mid-session, which invalidates any cached scheme
  const primary = rawBase(configuredUrl);
  const h1 = await probeHealth(primary);
  if (h1) {
    resolved = primary;
    return { state: h1.ai ? 'online' : 'offline', health: h1 };
  }
  const alt = altOf(primary);
  if (alt) {
    const h2 = await probeHealth(alt);
    if (h2) {
      resolved = alt;
      return { state: h2.ai ? 'online' : 'offline', health: h2 };
    }
  }
  return { state: 'offline', health: allDown };
}

export interface LiveModel {
  id: string;
  name: string;
  tier: string;
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
  try {
    const h = await fetchTimeout(`${base}/api/health`, 4000);
    if (h.ok) reachableBase = base;
  } catch { /* try alt below */ }
  if (!reachableBase) {
    const alt = altOf(base);
    if (alt) {
      try {
        const h = await fetchTimeout(`${alt}/api/health`, 4000);
        if (h.ok) {
          reachableBase = alt;
          resolved = alt;
        }
      } catch { /* demo path */ }
    }
  }

  if (!reachableBase) {
    await streamText(plan.response, onToken, { signal: opts.signal });
    return { text: plan.response, detectedLang: plan.detectedLang, demo: true };
  }
  const baseUrl = reachableBase;

  // ---- real path: POST SSE ----
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Content-Type': 'application/json' },
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
  let meta: { model?: string; tier?: string } = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      let ev: { meta?: { model: string; tier: string }; token?: string; done?: boolean; error?: string };
      try {
        ev = JSON.parse(s.slice(5).trim());
      } catch {
        continue; // partial chunk — wait for more
      }
      if (ev.error) throw new Error(ev.error);
      if (ev.meta) meta = ev.meta;
      if (typeof ev.token === 'string') {
        full = ev.token;
        onToken(full);
      }
      if (ev.done) {
        reader.cancel().catch(() => {});
        return { text: full, detectedLang: plan.detectedLang, demo: false, model: meta.model, tier: meta.tier };
      }
    }
  }
  if (!full) throw new Error('Empty response from gateway.');
  return { text: full, detectedLang: plan.detectedLang, demo: false, model: meta.model, tier: meta.tier };
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'Invalid target.');
  return j as { id: string; target: string; type: string; status: string };
}

export async function osintRun(configuredUrl: string, id: string) {
  const res = await fetch(`${baseOf(configuredUrl)}/api/osint/investigations/${id}/run`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not start investigation.');
}

export async function osintGet(configuredUrl: string, id: string) {
  const res = await fetch(`${baseOf(configuredUrl)}/api/osint/investigations/${id}`);
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
    `${baseOf(configuredUrl)}/api/osint/investigations/${id}/findings?type=${type}&confidence=${confidence}`
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
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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
