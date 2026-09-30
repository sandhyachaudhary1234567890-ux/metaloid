// Provider gateway — BYOK chat path with ordered fallback.
// Order: preferred model owner → default provider → fallback list → rest.
// Health-excluded providers are skipped; every attempt meters usage +
// records health. Total failure raises a FRIENDLY error naming what was
// tried (never a stack trace). No credentials = NO_CREDENTIALS (caller
// falls back to the platform-key path).

import { listUserCredentialProviders } from './credentialVault.js';
import { getProviderModels } from './providerRegistry.js';
import { getAdapter } from './providerAdapters.js';
import { getHealthManager, recordProviderCall } from './providerHealth.js';
import { recordProviderUsage } from './providerMeters.js';
import { emit } from './events.js';

function healthMap(userId) {
  try {
    const m = getHealthManager().getUserHealthStatuses(userId) || {};
    return new Map(Object.entries(m));
  } catch {
    return new Map();
  }
}

function firstModel(providerId) {
  const models = getProviderModels(providerId) || [];
  return models.length ? models[0].modelId : null;
}

export function orderProviders(userId, prefs = {}) {
  const creds = listUserCredentialProviders(userId).map((c) => c.providerId);
  const health = healthMap(userId);
  const bad = new Set(
    [...health.entries()].filter(([, h]) => h && (h.status === 'auth_failed' || h.status === 'unavailable')).map(([pid]) => pid)
  );
  const order = [];
  const push = (pid) => {
    if (creds.includes(pid) && !order.includes(pid)) order.push(pid);
  };
  // preferred model owner first (explicit model choice outranks provider choice)
  if (prefs.defaultModel) {
    for (const pid of creds) {
      if ((getProviderModels(pid) || []).some((m) => m.modelId === prefs.defaultModel)) push(pid);
    }
  }
  if (prefs.defaultProvider) push(prefs.defaultProvider);
  for (const pid of prefs.fallbackProviders || []) push(pid);
  for (const pid of creds) push(pid);
  const healthy = order.filter((pid) => !bad.has(pid));
  return { order: healthy.length ? healthy : order, skippedUnhealthy: order.filter((pid) => bad.has(pid)) };
}

function modelFor(providerId, prefs) {
  if (prefs.defaultModel && (getProviderModels(providerId) || []).some((m) => m.modelId === prefs.defaultModel)) {
    return prefs.defaultModel;
  }
  return firstModel(providerId);
}

export async function chatWithProviders({ userId, messages, system, prefs = {}, signal, onToken, onAttempt, maxTokens = 1200 }) {
  const { order, skippedUnhealthy } = orderProviders(userId, prefs);
  if (!order.length) {
    const e = new Error('NO_CREDENTIALS');
    e.code = 'NO_CREDENTIALS';
    throw e;
  }
  const tried = [];
  for (const pid of order) {
    const adapter = getAdapter(pid);
    if (!adapter) {
      tried.push({ providerId: pid, error: 'No adapter installed for this provider yet.' });
      continue;
    }
    const model = modelFor(pid, prefs);
    if (!model) {
      tried.push({ providerId: pid, error: 'No models registered.' });
      continue;
    }
    const t0 = Date.now();
    try {
      if (onAttempt) onAttempt({ providerId: pid, model });
      const out = await adapter.stream(userId, null, { model, messages, system, maxTokens, signal }, onToken);
      const ms = Date.now() - t0;
      recordProviderCall(pid, userId, null, true, ms, null);
      recordProviderUsage(userId, pid, {
        promptTokens: out?.usage?.promptTokens || 0,
        completionTokens: out?.usage?.completionTokens || 0,
        ms, ok: true,
      });
      emit('provider.chat_ok', { provider: pid, model, user: userId });
      return { providerId: pid, model, usage: out?.usage || null };
    } catch (e) {
      const ms = Date.now() - t0;
      const err = e && e.type ? e : { type: 'UNKNOWN', message: String((e && e.message) || e).slice(0, 200) };
      recordProviderCall(pid, userId, null, false, ms, err.message);
      recordProviderUsage(userId, pid, { ms, ok: false });
      tried.push({ providerId: pid, error: err.message || String(e).slice(0, 200) });
      // any failure moves to the next candidate (an invalid key on A must
      // never block a valid key on B); loop is bounded by candidate count
    }
  }
  const names = tried.map((t) => t.providerId).join(', ');
  const e = new Error(
    `Couldn't reach ${names || 'any provider'}.` +
    (skippedUnhealthy.length ? ` Skipped unhealthy: ${skippedUnhealthy.join(', ')}.` : '') +
    ' MetaIoid can use your connected fallback provider — check keys in Settings → AI Providers.'
  );
  e.code = 'ALL_PROVIDERS_FAILED';
  e.tried = tried;
  throw e;
}
