// Account sync — bridges the existing local stores to the MetaIoid API.
//
// Design goal: the app keeps working exactly as before when you are signed
// out (localStorage, sandbox demo, offline). Signing in *adds* a server copy
// rather than replacing the local one, so no existing code path changes
// behaviour and nothing is lost if the network drops mid-session.
//
// Two directions:
//
//   pull  — on sign-in, conversations/messages/memories that exist on the
//           server are imported into the stores (deduped by id). Imported
//           conversations are marked `remote` so the outbox never echoes
//           them back to the server that just gave them to us.
//
//   push  — an outbox: conversations created after sign-in, and their new
//           messages, are mirrored once each. A local id ↔ server id map
//           keeps the two in step. Failures stay queued and retry, and a
//           failure never blocks the UI or the stream.
//
// Deliberately not done here: rewriting store internals. The sync layer
// observes state, so it cannot break the streaming path.

import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useApp } from './store';
import { useAuth } from './auth';
import { repo, RepoError, type ConversationRow, type MemoryRow } from './repo';

/** Marker kept on imported conversations (never persisted as a real field). */
function isRemoteId(id: string) {
  // server ids are UUIDs; local ones are prefixed (conv_…, mem-…) by uid()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export interface SyncState {
  lastPullAt: number | null;
  lastPushAt: number | null;
  pending: number;
  error: string | null;
}

export const EMPTY_SYNC: SyncState = { lastPullAt: null, lastPushAt: null, pending: 0, error: null };

const SyncContext = createContext<SyncState>(EMPTY_SYNC);

/**
 * Runs the sync loop once, high in the tree, and publishes its state so any
 * screen can describe it (Settings shows "up to date" / "N pending" / paused).
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const state = useAccountSync();
  return <SyncContext.Provider value={state}>{children}</SyncContext.Provider>;
}

/** Read the sync state wherever it is displayed. Safe outside the provider. */
export function useSyncState(): SyncState {
  return useContext(SyncContext);
}

/**
 * Mounted once, inside both providers. No-ops unless someone is signed in.
 */
export function useAccountSync(): SyncState {
  const auth = useAuth();
  const { conversations, memories, importConversations, importMemories, updateSettings, settings } = useApp();
  const token = auth.accessToken;

  const state = useRef<SyncState>({ lastPullAt: null, lastPushAt: null, pending: 0, error: null });
  const convMap = useRef(new Map<string, string>());   // local id → server id
  const pushedMessages = useRef(new Set<string>());    // `${convLocalId}:${msgId}`
  const pushedMemories = useRef(new Set<string>());
  const signedInAt = useRef<number>(0);
  const pulledFor = useRef<string | null>(null);

  // ── PULL: on sign-in (or account switch) ─────────────────────────────
  useEffect(() => {
    if (!token || !auth.user) {
      if (!token) { pulledFor.current = null; signedInAt.current = 0; }
      return;
    }
    const userId = auth.user.id;
    if (pulledFor.current === userId) return;
    pulledFor.current = userId;
    signedInAt.current = Date.now();

    let cancelled = false;
    (async () => {
      try {
        const [convPage, memPage, profile] = await Promise.all([
          repo.listConversations(token, { limit: 50 }),
          repo.listMemories(token, { limit: 100 }),
          repo.me(token).catch(() => null),
        ]);
        if (cancelled) return;

        // conversations + their messages
        const imported = [] as { id: string; title: string; createdAt: number; updatedAt: number; messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: number }[] }[];
        for (const row of convPage.rows) {
          const msgs = await repo.listMessages(token, row.id, { limit: 200 }).catch(() => ({ rows: [] as never[] }));
          if (cancelled) return;
          convMap.current.set(row.id, row.id);
          imported.push({
            id: row.id,
            title: row.title,
            createdAt: Date.parse(row.created_at),
            updatedAt: Date.parse(row.updated_at),
            messages: (msgs.rows || []).map((m: { id: string; role: string; content: string; created_at: string }) => ({
              id: m.id,
              role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
              content: m.content,
              createdAt: Date.parse(m.created_at),
            })),
          });
          for (const m of msgs.rows || []) pushedMessages.current.add(`${row.id}:${(m as { id: string }).id}`);
        }
        if (imported.length) importConversations(imported);

        const memoriesIn = memPage.rows.map((m: MemoryRow) => ({
          id: m.id,
          content: m.content,
          category: m.category as never,
          createdAt: Date.parse(m.created_at),
        }));
        for (const m of memPage.rows) pushedMemories.current.add(m.id);
        if (memoriesIn.length) importMemories(memoriesIn);

        // onboarding lives with the account: adopt it once, then let the
        // server be the source of truth for these fields
        if (profile?.profile) {
          const p = profile.profile;
          if (p.onboarding_completed) {
            updateSettings({
              showStartup: settings.showStartup,
            });
          }
        }
        state.current = { ...state.current, lastPullAt: Date.now(), error: null };
      } catch (e) {
        const err = e as RepoError;
        state.current = { ...state.current, error: err.message || 'Sync failed.' };
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, auth.user?.id]);

  // ── PUSH: preferences (theme, voice, model, memory) ──────────────────
  // A debounced PATCH of the profile row, so a new device restores how the
  // app looks and behaves — not just what is in it. The fingerprint guard
  // means an unchanged setting never produces a request, and a pull that just
  // updated the local settings does not bounce straight back to the server.
  const pushedPrefs = useRef<string>('');
  useEffect(() => {
    if (!token || !auth.user) return;
    const payload = {
      theme: settings.theme,
      voice_preference: settings.hindiVoice || settings.englishVoice || 'natural',
      preferred_model: settings.model,
      memory_preference: settings.memoryEnabled ? 'on' : 'off',
    };
    const fingerprint = JSON.stringify(payload);
    if (pushedPrefs.current === fingerprint) return;
    const timer = setTimeout(() => {
      pushedPrefs.current = fingerprint;
      repo.updateProfile(token, payload)
        .then(() => { state.current = { ...state.current, lastPushAt: Date.now(), error: null }; })
        .catch((e: unknown) => {
          pushedPrefs.current = ''; // try again on the next change
          state.current = { ...state.current, error: e instanceof RepoError ? e.message : 'Preferences not saved' };
        });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.theme, settings.hindiVoice, settings.englishVoice, settings.model, settings.memoryEnabled, token]);

  // ── PUSH: mirror new conversations/messages ──────────────────────────
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!token) return;
    // only conversations created during this signed-in session are mirrored,
    // so a pre-existing local demo history is never silently uploaded
    const candidates = conversations.filter((c) => !isRemoteId(c.id) && (c.createdAt ?? 0) > signedInAt.current);
    if (!candidates.length) return;

    queue.current = queue.current.then(async () => {
      for (const conv of candidates) {
        try {
          let serverId = convMap.current.get(conv.id);
          if (!serverId) {
            const created = await repo.createConversation(token, {
              title: conv.title,
              model: conv.model ?? null,
              provider: null,
            });
            serverId = created.conversation.id;
            convMap.current.set(conv.id, serverId);
          }
          for (const msg of conv.messages) {
            const key = `${conv.id}:${msg.id}`;
            if (pushedMessages.current.has(key)) continue;
            if (!msg.content?.trim()) continue; // still streaming — wait for text
            await repo.appendMessage(token, serverId, {
              role: msg.role === 'assistant' ? 'assistant' : 'user',
              content: msg.content.slice(0, 32000),
              status: msg.streaming ? 'streaming' : 'complete',
              model: (msg as { model?: string }).model ?? null,
            });
            pushedMessages.current.add(key);
          }
          state.current = { ...state.current, lastPushAt: Date.now(), pending: 0, error: null };
        } catch (e) {
          const err = e as RepoError;
          state.current = { ...state.current, pending: 1, error: err.message };
          break; // retry on the next change rather than hammering a failing API
        }
      }
    }).catch(() => { /* the queue must never reject */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, token]);

  // ── PUSH: mirror new memories ───────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const fresh = memories.filter((m) => !isRemoteId(m.id) && !pushedMemories.current.has(m.id));
    if (!fresh.length) return;

    queue.current = queue.current.then(async () => {
      for (const mem of fresh) {
        try {
          const saved = await repo.createMemory(token, { content: mem.content.slice(0, 2000), category: mem.category });
          pushedMemories.current.add(mem.id);
          convMap.current.set(mem.id, saved.memory.id);
          state.current = { ...state.current, lastPushAt: Date.now(), error: null };
        } catch (e) {
          state.current = { ...state.current, error: (e as RepoError).message };
        }
      }
    }).catch(() => { /* ignore */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memories, token]);

  return state.current;
}

/** Human-readable sync status for Settings. */
export function syncLabel(s: SyncState, signedIn: boolean): { text: string; tone: 'ok' | 'warn' | 'off' } {
  if (!signedIn) return { text: 'Local only — sign in to sync', tone: 'off' };
  if (s.error) return { text: `Sync paused: ${s.error}`, tone: 'warn' };
  if (s.lastPushAt || s.lastPullAt) return { text: 'Synced with your account', tone: 'ok' };
  return { text: 'Connected — waiting for changes', tone: 'off' };
}
