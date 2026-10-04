// Account bridge — the seam between the account-data contract and the core.
//
// The app writes its provider choice, model choice and API keys through the
// API-v1 contract (src/lib/repo.ts → /api/v1/provider/*), which lands in the
// account-data layer. The chat core (providerGateway, providerAdapters,
// credentialVault) was written against an older file-backed vault. Without a
// bridge the two halves of the product never meet: the user picks a model,
// the UI confirms it, the row is saved — and chat happily uses something else.
//
// This module is deliberately tiny and read-mostly. It does not store
// anything: it reads the one place account settings actually live and hands
// them to the core in the shape the core already expects. There is no second
// source of truth, and no duplicated state.

import * as account from '../data/index.js';

/** Settings + decrypted credentials for one account. */
const asCtx = (userId) => ({ userId });

/**
 * Provider/model preferences as the router's `prefs` object.
 * Only fields the account has actually set are returned, so the caller can
 * merge without clobbering its own defaults with `undefined`.
 */
export async function prefsFor(userId) {
  if (!userId) return {};
  try {
    const settings = await account.providerSettings.get(asCtx(userId));
    if (!settings) return {};
    const prefs = {};
    if (settings.default_model) prefs.defaultModel = settings.default_model;
    if (settings.default_provider) prefs.defaultProvider = settings.default_provider;
    if (typeof settings.free_only === 'boolean') prefs.freeOnly = settings.free_only;
    if (typeof settings.fallback_enabled === 'boolean') prefs.fallbackEnabled = settings.fallback_enabled;
    return prefs;
  } catch {
    // A settings read must never be the reason a chat fails; the core falls
    // back to its own defaults, which is exactly the pre-settings behaviour.
    return {};
  }
}

/**
 * The account's stored secret for a provider, decrypted for one outbound
 * call. Returns null when there is no credential — never a platform key,
 * which the adapters resolve separately.
 */
export async function credentialFor(userId, providerId) {
  if (!userId || !providerId) return null;
  try {
    const found = await account.providerCredentials.revealPlaintext(asCtx(userId), providerId, 'default');
    return found?.secret || null;
  } catch (e) {
    // A key that is stored but unreadable is NOT "no key": swallowing it here
    // is what let a broken credential look like a healthy one forever. Only
    // the store's own "unreadable" verdict is re-thrown; anything else (a
    // transient read failure) keeps the old, safe behaviour.
    if (e && e.code === 'credential_unreadable') throw e;
    return null;
  }
}

/** Provider ids this account holds a usable credential for. */
export async function credentialedProviders(userId) {
  if (!userId) return [];
  try {
    const rows = await account.providerCredentials.list(asCtx(userId));
    // Only credentials the account has actually proven, or not yet tested,
    // are offered as candidates. A key we know is rejected would just burn a
    // turn and a retry budget.
    return rows.filter((r) => r.status !== 'invalid').map((r) => r.provider);
  } catch {
    return [];
  }
}

/** Persist a secret through the contract (encrypted at rest by the driver). */
export async function saveCredential(userId, providerId, secret, label = 'default') {
  return account.providerCredentials.upsert(asCtx(userId), { provider: providerId, label, secret });
}

/** Record the outcome of a connection test so the next page load shows it. */
export async function recordCredentialStatus(userId, providerId, status, label = 'default') {
  return account.providerCredentials.setStatus(asCtx(userId), providerId, status, label);
}

export async function removeCredential(userId, providerId, label = 'default') {
  return account.providerCredentials.remove(asCtx(userId), providerId, label);
}

export async function listCredentials(userId) {
  return account.providerCredentials.list(asCtx(userId));
}

/** Which storage driver is answering — surfaced by health, useful in logs. */
export const driver = () => account.driverName();
