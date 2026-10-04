import type { ChatMessage, Conversation } from './types';
import { zipRead, zipStore } from './zip';
import { repo } from './repo';
import { sbAccessToken } from './supabaseAuth';
import { getActiveUser } from './storage';

// History Vault — 3-day auto-expiry with automatic rescue.
//
// Rule: a conversation untouched for HISTORY_TTL_MS is deleted. Before the
// delete, its content is packed into a portable vault .zip (one file per
// snapshot, all expired chats inside) and downloaded, so nothing is ever lost
// silently. Days later the user hands that same file back (History → Restore
// vault) and the chats return with a fresh timer.
//
// Pinned conversations are never swept. Server rows (signed-in accounts) are
// deleted through the same API as a manual delete, best-effort: the local
// delete always happens, a failed server delete is reported, never retried
// into a loop.

export const HISTORY_TTL_MS = 3 * 24 * 3600 * 1000;
const VAULT_MAGIC = 'metaloid-history-vault';
const VAULT_VERSION = 1;

export interface VaultOwner {
  kind: 'sb' | 'local';
  id: string;
}

interface VaultMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  detectedLang?: string;
  vision?: boolean;
  feedback?: 'up' | 'down';
}

interface VaultConversation {
  id: string;
  title: string;
  preview?: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  model: Conversation['model'];
  language: Conversation['language'];
  messages: VaultMessage[];
  attachmentsOmitted: number;
}

interface VaultSnapshot {
  app: typeof VAULT_MAGIC;
  version: typeof VAULT_VERSION;
  owner: VaultOwner;
  exportedAt: string;
  reason: 'auto-expiry' | 'manual';
  conversations: VaultConversation[];
}

export function isExpired(c: Conversation, now = Date.now()): boolean {
  if (c.pinned) return false;
  return now - c.updatedAt > HISTORY_TTL_MS;
}

export function partitionByExpiry(convs: Conversation[], now = Date.now()): { expired: Conversation[]; kept: Conversation[] } {
  const expired: Conversation[] = [];
  const kept: Conversation[] = [];
  for (const c of convs) (isExpired(c, now) ? expired : kept).push(c);
  return { expired, kept };
}

function toVaultMessage(m: ChatMessage): VaultMessage {
  const v: VaultMessage = { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt };
  if (m.detectedLang) v.detectedLang = m.detectedLang;
  if (m.vision) v.vision = true;
  if (m.feedback) v.feedback = m.feedback;
  return v;
}

/** Serialize conversations in parallel batches (large histories stay smooth). */
export async function buildSnapshot(
  convs: Conversation[],
  owner: VaultOwner,
  reason: VaultSnapshot['reason'],
): Promise<VaultSnapshot> {
  const chunks: Conversation[][] = [];
  for (let i = 0; i < convs.length; i += 25) chunks.push(convs.slice(i, i + 25));
  const parts = await Promise.all(
    chunks.map(async (group) =>
      group.map((c): VaultConversation => {
        let omitted = 0;
        const messages = c.messages.map((m) => {
          if (m.attachments?.length) omitted += m.attachments.length;
          return toVaultMessage(m);
        });
        return {
          id: c.id,
          title: c.title,
          preview: c.preview,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          pinned: c.pinned,
          model: c.model,
          language: c.language,
          messages,
          attachmentsOmitted: omitted,
        };
      }),
    ),
  );
  return {
    app: VAULT_MAGIC,
    version: VAULT_VERSION,
    owner,
    exportedAt: new Date().toISOString(),
    reason,
    conversations: parts.flat(),
  };
}

const te = new TextEncoder();
const td = new TextDecoder();

export function packSnapshot(snap: VaultSnapshot): { bytes: Uint8Array; fileName: string } {
  const bytes = zipStore([{ name: 'vault.json', data: te.encode(JSON.stringify(snap)) }]);
  const day = snap.exportedAt.slice(0, 10);
  return { bytes, fileName: `metaloid-vault-${day}-${snap.conversations.length}chats.zip` };
}

export function parseSnapshot(bytes: Uint8Array): VaultSnapshot {
  const entries = zipRead(bytes);
  const file = entries.find((e) => e.name === 'vault.json') || entries[0];
  if (!file) throw new Error('That zip holds nothing this app can restore.');
  let snap: VaultSnapshot;
  try {
    snap = JSON.parse(td.decode(file.data));
  } catch {
    throw new Error('That zip is not a MetaIoid history vault.');
  }
  if (!snap || snap.app !== VAULT_MAGIC || snap.version !== VAULT_VERSION || !Array.isArray(snap.conversations)) {
    throw new Error('That zip is not a MetaIoid history vault.');
  }
  if (!snap.owner || typeof snap.owner.id !== 'string' || !snap.owner.id) {
    throw new Error('That vault has no owner stamp and cannot be trusted.');
  }
  return snap;
}

/** Merge a snapshot back into history. Restored chats get a fresh timer. */
export function mergeSnapshot(
  existing: Conversation[],
  snap: VaultSnapshot,
  owner: VaultOwner,
  now = Date.now(),
): { merged: Conversation[]; restored: number; skippedOwnerMismatch: boolean } {
  if (snap.owner.kind !== owner.kind || snap.owner.id !== owner.id) {
    return { merged: existing, restored: 0, skippedOwnerMismatch: true };
  }
  const byId = new Map(existing.map((c) => [c.id, c]));
  let restored = 0;
  for (const v of snap.conversations) {
    if (!v || typeof v.id !== 'string' || !Array.isArray(v.messages)) continue;
    const cur = byId.get(v.id);
    const incoming: Conversation = {
      id: v.id,
      title: String(v.title || 'Restored chat').slice(0, 120),
      preview: typeof v.preview === 'string' ? v.preview : undefined,
      createdAt: Number(v.createdAt) || now,
      updatedAt: now, // restore reactivates: the 3-day timer restarts here
      pinned: cur?.pinned ?? v.pinned ?? false,
      model: (v.model as Conversation['model']) || 'auto',
      language: (v.language as Conversation['language']) || 'auto',
      messages: v.messages
        .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
        .map((m, i) => ({
          id: String(m.id || `msg-restored-${i}`),
          role: m.role,
          content: m.content,
          createdAt: Number(m.createdAt) || now,
          ...(m.detectedLang ? { detectedLang: m.detectedLang } : {}),
          ...(m.vision ? { vision: true as const } : {}),
          ...(m.feedback ? { feedback: m.feedback } : {}),
        })),
    };
    if (!cur || v.updatedAt > cur.updatedAt) {
      byId.set(v.id, incoming);
      restored++;
    }
  }
  return {
    merged: [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    restored,
    skippedOwnerMismatch: false,
  };
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Owner stamp for this device/session. Signed-in wins, else the local user. */
export async function currentOwner(sbUserId: string | null): Promise<VaultOwner> {
  if (sbUserId) return { kind: 'sb', id: sbUserId };
  return { kind: 'local', id: getActiveUser() || 'local' };
}

export interface SweepDeps {
  conversations: Conversation[];
  deleteConversation: (id: string) => void;
  backendUrl: string;
  owner: VaultOwner;
  toast: (t: { title: string; desc?: string; tone?: 'error' | 'success' }) => void;
}

let sweptThisBoot = false;

/**
 * Archive-then-delete everything past the TTL. Runs once per page load;
 * History and Chat both call it, the guard keeps it to a single pass.
 */
export async function runVaultSweepOnce(deps: SweepDeps): Promise<{ archived: number }> {
  if (sweptThisBoot) return { archived: 0 };
  sweptThisBoot = true;
  const { expired } = partitionByExpiry(deps.conversations);
  if (!expired.length) return { archived: 0 };
  try {
    const snap = await buildSnapshot(expired, deps.owner, 'auto-expiry');
    const { bytes, fileName } = packSnapshot(snap);
    downloadBytes(bytes, fileName);
    const token = await sbAccessToken().catch(() => null);
    await Promise.all(
      expired.map(async (c) => {
        deps.deleteConversation(c.id);
        if (token) {
          try {
            await repo.deleteConversation(token, c.id, deps.backendUrl);
          } catch {
            /* local delete already happened; server row retries on next sync */
          }
        }
      }),
    );
    deps.toast({
      title: `Archived ${expired.length} old chat${expired.length === 1 ? '' : 's'} to ${fileName}`,
      desc: 'Untouched for 3+ days. Restore it anytime from History → Restore vault.',
    });
    return { archived: expired.length };
  } catch (e) {
    // Never delete what could not be archived: the export failing must leave
    // history exactly as it was.
    deps.toast({
      title: 'Auto-archive failed — nothing was deleted.',
      desc: e instanceof Error ? e.message : 'Try History → Export vault manually.',
      tone: 'error',
    });
    return { archived: 0 };
  }
}
