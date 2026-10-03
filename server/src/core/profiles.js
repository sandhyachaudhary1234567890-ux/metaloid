// Profiles — user-specific personality, preferences, onboarding state.
// Builds on (not beside) server memory: explicit CONFIRMED prefs live here;
// INFERRED leanings live in memory records with confidence+decay and only
// graduate here after user confirmation. SYSTEM DEFAULTS fill the rest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'profiles.json');

export const AUTONOMY_MODES = ['passive', 'assisted', 'proactive', 'autonomous'];
export const TONES = ['neutral', 'warm', 'concise', 'playful', 'formal'];
export const VERBOSITY = ['brief', 'balanced', 'detailed'];

const DEFAULTS = {
  displayName: '',
  language: 'auto', // auto | en | hi | hinglish
  timezone: '',
  tone: 'neutral',
  verbosity: 'balanced',
  voice: 'Natural English',
  voiceSpeed: 1,
  proactivity: 'assisted', // user-facing name for autonomy level
  autonomy: 'assisted', // passive | assisted | proactive | autonomous (policy)
  theme: 'obsidian',
  interests: [],
  goals: [],
  notifyImportantOnly: true,
  quietHours: null, // {start:'22:00', end:'07:00'} | null
  defaultModel: 'auto',
  costPriority: 'balanced', // speed | quality | cost | balanced
  // provider routing prefs (BYOK): null = Auto
  defaultProvider: null, // 'openai' | 'anthropic' | ... | null
  fallbackProviders: [], // ordered providerIds tried after the default
  favoriteModels: [], // 'providerId:modelId' picks surfaced in the UI
  onboardingDone: false,
  onboardedAt: null,
  updatedAt: null,
};

function load() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { /* start empty */ }
  return { profiles: {} };
}
let store = load();
const persist = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 1).slice(0, 2_000_000));
  } catch { /* ignore */ }
};

const ALLOWED_KEYS = new Set(Object.keys(DEFAULTS));

async function supa() {
  const m = await import('./supadb.js');
  return m.dbMode() ? m : null;
}

export async function getProfile(userId) {
  const db = await supa();
  if (db) {
    const row = await db.profileGet(userId);
    return { ...DEFAULTS, ...(row || {}), userId };
  }
  const p = store.profiles[userId];
  return { ...DEFAULTS, ...(p || {}), userId };
}

/** Validate + sanitize a patch (sync, shared by both modes). */
function sanitizePatch(patch = {}) {
  const next = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_KEYS.has(k) || v === undefined) continue;
    if (k === 'tone' && !TONES.includes(v)) continue;
    if (k === 'verbosity' && !VERBOSITY.includes(v)) continue;
    if (k === 'autonomy' && !AUTONOMY_MODES.includes(v)) continue;
    if (k === 'proactivity' && !['low', 'assisted', 'high'].includes(v) && !AUTONOMY_MODES.includes(v)) continue;
    if (k === 'language' && !['auto', 'en', 'hi', 'hinglish'].includes(v)) continue;
    if (k === 'interests' || k === 'goals' || k === 'fallbackProviders' || k === 'favoriteModels') {
      if (!Array.isArray(v)) continue;
      next[k] = v.map((x) => String(x).slice(0, 120)).slice(0, 20);
      continue;
    }
    if (k === 'defaultProvider' && v !== null && typeof v !== 'string') continue;
    if (typeof v === 'string') next[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) next[k] = v;
  }
  return next;
}

/** Only known keys, validated values. Unknown keys are dropped, never stored. */
export async function updateProfile(userId, patch = {}) {
  const clean = sanitizePatch(patch);
  clean.updatedAt = new Date().toISOString();
  if (clean.onboardingDone && !clean.onboardedAt) clean.onboardedAt = clean.updatedAt;
  const db = await supa();
  if (db) {
    await db.profileUpsert(userId, clean);
    emit('user.profile_updated', { user: userId });
    return getProfile(userId);
  }
  const cur = await getProfile(userId);
  const next = { ...cur, ...clean };
  delete next.userId;
  store.profiles[userId] = next;
  persist();
  emit('user.profile_updated', { user: userId });
  return getProfile(userId);
}

/** First-run: only what is necessary. Everything else is learned safely. */
export async function completeOnboarding(userId, answers = {}) {
  const patch = { onboardingDone: true, onboardedAt: new Date().toISOString() };
  for (const k of ['displayName', 'language', 'timezone', 'tone', 'verbosity', 'voice', 'proactivity', 'autonomy', 'interests', 'goals']) {
    if (answers[k] !== undefined) patch[k] = answers[k];
  }
  return updateProfile(userId, patch);
}

export async function deleteProfile(userId) {
  const { dbMode, profileDelete } = await import('./supadb.js');
  if (dbMode()) {
    await profileDelete(userId);
  }
  delete store.profiles[userId];
  persist();
}

/** Server-side personalization lines for the system prompt. */
export async function personalizationBlock(userId) {
  const p = await getProfile(userId);
  const lines = [];
  if (p.displayName) lines.push(`User's name: ${p.displayName}`);
  if (p.language && p.language !== 'auto') lines.push(`Reply language: ${p.language}`);
  if (p.tone === 'concise' || p.verbosity === 'brief') lines.push('Style: concise — short answers by default, expand only on request.');
  else if (p.verbosity === 'detailed') lines.push('Style: detailed — thorough explanations welcome.');
  if (p.tone && p.tone !== 'neutral' && p.tone !== 'concise') lines.push(`Tone: ${p.tone}.`);
  const auto = { passive: 'PASSIVE: wait for the user; do not suggest follow-ups.', assisted: 'ASSISTED: answer, then suggest at most one useful next step.', proactive: 'PROACTIVE: answer and take obvious helpful follow-ups, narrating each.', autonomous: 'AUTONOMOUS: execute approved task classes in background; report when done.' }[p.autonomy];
  if (auto) lines.push(`Autonomy policy (${p.autonomy.toUpperCase()}): ${auto}`);
  if (p.goals?.length) lines.push(`User goals: ${p.goals.join('; ')}`);
  return lines.length ? '\n\nPERSONALIZATION (user-confirmed, binding):\n' + lines.map((l) => `- ${l}`).join('\n') : '';
}
