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
import { prefsFor } from './accountBridge.js';
import { listFreeModels, pickCandidates } from '../openrouter.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Bounded retry: retryable errors get ONE retry with exponential backoff +
 * jitter, then we move to the next candidate. Never retries auth/bad-input. */
async function streamOnce(adapter, userId, args, onToken) {
  try {
    return { out: await adapter.stream(userId, null, args, onToken), retried: false };
  } catch (e) {
    const retryable = !!(e && (e.retryable === true || e.type === 'RATE_LIMITED' || e.type === 'TIMEOUT' || e.type === 'UNAVAILABLE'));
    if (!retryable || (args.signal && args.signal.aborted)) throw e;
    const delay = 400 + Math.floor(Math.random() * 600); // ~400–1000ms jittered
    await sleep(delay);
    if (args.signal && args.signal.aborted) throw e;
    return { out: await adapter.stream(userId, null, args, onToken), retried: true };
  }
}

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

/**
 * Choose the model for one attempt.
 *
 * The provider registry carries a static manifest, and for OpenRouter it
 * declares `models: []` because the catalogue is fetched at runtime. Nothing
 * used to bridge the two, so the router resolved no model at all and BYOK
 * chat failed with "No models registered" no matter what the user had picked
 * in the UI. The live catalogue is that bridge.
 *
 * Free-first is a property of the catalogue, not a filter applied afterwards:
 * `listFreeModels()` keeps only `:free` slugs, so a paid model cannot be
 * reached by a fallback. A saved model is honoured when it is a live free
 * candidate; when it is not, the router says so rather than quietly swapping
 * the user's choice for a different one.
 */
async function chooseModel(providerId, prefs, task) {
  const registered = getProviderModels(providerId) || [];
  if (registered.length) {
    const saved = prefs.defaultModel;
    if (saved && registered.some((m) => m.modelId === saved)) return saved;
    return registered[0].modelId;
  }

  if (providerId !== 'openrouter') return null;

  const free = await listFreeModels().catch(() => []);
  const ordered = pickCandidates(free, task, 8).map((m) => m.id);
  const saved = prefs.defaultModel;
  if (saved && ordered.includes(saved)) return saved;
  if (saved && !ordered.includes(saved)) {
    // Visible, not silent: the operator can see the saved slug was skipped
    // (dead, quarantined, or no longer offered) instead of wondering why the
    // reply came from a different model.
    emit('provider.saved_model_skipped', { provider: providerId, saved });
  }
  return ordered[0] || null;
}

export async function orderProviders(userId, prefs = {}) {
  const creds = (await listUserCredentialProviders(userId)).map((c) => c.providerId);
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

export async function chatWithProviders({ userId, messages, system, prefs = {}, task = 'chat', signal, onToken, onAttempt, maxTokens = 1200 }) {
  // The account's saved model and provider come from the v1 contract — the
  // screen that let the user choose them writes there, and nowhere else.
  // Merged *over* the caller's prefs so the persisted choice wins; a field
  // the account has not set is left absent rather than blanked.
  const account = await prefsFor(userId);
  const effective = { ...prefs, ...account };
  const { order, skippedUnhealthy } = await orderProviders(userId, effective);
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
    const model = await chooseModel(pid, effective, task);
    if (!model) {
      tried.push({ providerId: pid, error: 'No models registered.' });
      continue;
    }
    const t0 = Date.now();
    try {
      if (onAttempt) onAttempt({ providerId: pid, model });
      const { out } = await streamOnce(adapter, userId, { model, messages, system, maxTokens, signal }, onToken);
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
