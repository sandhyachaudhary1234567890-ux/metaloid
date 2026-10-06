import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Pin, Pencil, Trash2, Plus, X, Archive, Upload } from 'lucide-react';
import { useApp } from '../lib/store';
import { groupConversations, timeAgo, cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { EmptyState } from '../components/ui/EmptyState';
import {
  buildSnapshot, currentOwner, downloadBytes, mergeSnapshot, packSnapshot,
  parseSnapshot, runVaultSweepOnce,
} from '../lib/historyVault';

// HISTORY — conversations only: title · preview · time.
// Open · rename · delete. Semantic tokens throughout.

function highlight(title: string, q: string) {
  if (!q.trim()) return title;
  const i = title.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return title;
  return (
    <>
      {title.slice(0, i)}
      <mark className="bg-[var(--accent-subtle)] text-[var(--accent)] rounded px-1">{title.slice(i, i + q.length)}</mark>
      {title.slice(i + q.length)}
    </>
  );
}

export function HistoryScreen() {
  const { conversations, selectConversation, deleteConversation, pinConversation, renameConversation, openModal, newConversation, setView, mergeConversations, settings, toast } = useApp();
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Auto-archive runs once per boot from every screen that can host it.
  useEffect(() => {
    void (async () => {
      const owner = await currentOwner(auth.user?.id ?? null);
      await runVaultSweepOnce({
        conversations, deleteConversation,
        backendUrl: settings.backendUrl, owner,
        toast: (t) => toast(t),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportVaultNow = async () => {
    if (!conversations.length || vaultBusy) return;
    setVaultBusy(true);
    try {
      const owner = await currentOwner(auth.user?.id ?? null);
      const snap = await buildSnapshot(conversations, owner, 'manual');
      const { bytes, fileName } = packSnapshot(snap);
      downloadBytes(bytes, fileName);
      toast({ title: `Exported ${conversations.length} chats to ${fileName}` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Export failed.', tone: 'error' });
    } finally {
      setVaultBusy(false);
    }
  };

  const restoreVaultFile = async (f: File) => {
    setVaultBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const snap = parseSnapshot(bytes);
      const owner = await currentOwner(auth.user?.id ?? null);
      const { merged, restored, skippedOwnerMismatch } = mergeSnapshot(conversations, snap, owner);
      if (skippedOwnerMismatch) {
        toast({ title: 'That vault belongs to a different account.', desc: 'Sign in as its owner to restore it.', tone: 'error' });
        return;
      }
      mergeConversations(merged.filter((c) => !conversations.some((e) => e.id === c.id && e.updatedAt >= c.updatedAt)));
      toast({ title: restored ? `Restored ${restored} chat${restored === 1 ? '' : 's'} — timer restarted.` : 'Nothing new — history already has these.' });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Restore failed.', tone: 'error' });
    } finally {
      setVaultBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const filtered = useMemo(() => {
    const list = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    // Forgiving: match the title, the preview, or anything said in the thread.
    return list.filter((c) =>
      c.title.toLowerCase().includes(needle)
      || (c.preview ?? '').toLowerCase().includes(needle)
      || c.messages.some((m) => m.content.toLowerCase().includes(needle))
    );
  }, [conversations, q]);

  const groups = groupConversations(filtered);

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-8 py-6 pb-32 md:pb-12">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="t-display text-[var(--fg)]">History</h2>
          <p className="text-ui text-[var(--fg-muted)] mt-0.5">
            {conversations.length === 0
              ? 'Nothing yet'
              : `${conversations.length} ${conversations.length === 1 ? 'conversation' : 'conversations'}`}
            {auth.status === 'signed-in' ? ' · synced to your account' : ' · saved on this device'}
          </p>
        </div>
        <button onClick={() => { newConversation(); setView('chat'); }} className="btn-primary h-10 px-3.5 text-ui ml-auto min-h-[40px]">
          <Plus size={15} /> New chat
        </button>
      </div>

      <div className="mt-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
        <p className="flex items-center gap-2 text-ui font-semibold text-[var(--fg)]">
          <Archive size={14} className="text-[var(--accent)] shrink-0" />
          History Vault
        </p>
        <p className="mt-1 text-small text-[var(--fg-muted)] text-pretty">
          Chats untouched for 3+ days auto-archive into a vault zip (downloaded for you) before they are deleted. Pinned chats are kept. Bring a vault file back anytime — its chats return with a fresh 3-day timer.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            onClick={() => void exportVaultNow()}
            disabled={vaultBusy || conversations.length === 0}
            className="h-9 px-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-small font-medium text-[var(--fg)] disabled:opacity-50 hover:border-[var(--accent)] transition-colors"
          >
            {vaultBusy ? 'Working…' : 'Export vault now'}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={vaultBusy}
            className="h-9 px-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-small font-medium text-[var(--fg)] disabled:opacity-50 hover:border-[var(--accent)] transition-colors flex items-center gap-1.5"
          >
            <Upload size={13} /> Restore vault file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            aria-label="Restore history vault file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restoreVaultFile(f);
            }}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2.5 input-shell px-3.5 h-10">
        <Search size={15} className="text-[var(--fg-muted)] shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations…"
          className="flex-1 bg-transparent outline-none text-ui text-[var(--fg)] placeholder:text-[var(--fg-muted)]"
          aria-label="Search conversations"
        />
        {q && <button onClick={() => setQ('')} className="icon-btn w-6 h-6" aria-label="Clear"><X size={13} /></button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          art="conversations"
          title={q ? 'Nothing matched that' : 'No conversations yet'}
          description={
            q
              ? 'Try a shorter word, or part of a message you remember.'
              : 'Start one from Chat — it will be waiting here.'
          }
          action={
            !q ? (
              <button
                onClick={() => { newConversation(); setView('chat'); }}
                className="btn-primary h-9 gap-1.5 px-3.5 text-ui"
              >
                <Plus size={14} strokeWidth={1.8} />
                Start a chat
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((g) => (
            <section key={g.label}>
              <div className="label-caps mb-2.5">{g.label}</div>
              <div className="space-y-1.5">
                {[...g.items].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)).map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="surface px-4 py-3 flex items-center gap-3 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] transition-all group"
                  >
                    <button onClick={() => selectConversation(c.id)} className="flex-1 min-w-0 text-left min-h-[40px]" aria-label={`Open ${c.title}`}>
                      <span className="flex items-center gap-2 text-body font-medium text-[var(--fg)] truncate">
                        {c.pinned && <Pin size={13} className="text-[var(--accent)] shrink-0" fill="currentColor" />}
                        {editingId === c.id ? (
                          <input
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { renameConversation(c.id, editVal || c.title); setEditingId(null); }
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="bg-[var(--surface-sunken)] border border-[var(--border)] rounded-lg px-2 py-1 text-ui text-[var(--fg)] outline-none w-full focus:border-[var(--accent)]"
                            autoFocus
                            aria-label="Conversation title"
                          />
                        ) : highlight(c.title, q)}
                      </span>
                      <span className="block text-small text-[var(--fg-muted)] mt-0.5 truncate">{c.preview || `${c.messages.length} messages`}</span>
                      <span className="block text-micro text-[var(--fg-subtle)] mt-0.5">{timeAgo(c.updatedAt)}</span>
                    </button>
                    <span className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => pinConversation(c.id)}
                        className={cn('icon-btn w-8 h-8', c.pinned && 'text-[var(--accent)] opacity-100')}
                        title={c.pinned ? 'Unpin' : 'Pin'}
                        aria-label="Pin conversation"
                      >
                        <Pin size={13} fill={c.pinned ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => { setEditingId(c.id); setEditVal(c.title); }}
                        className="icon-btn w-8 h-8"
                        title="Rename"
                        aria-label="Rename conversation"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => openModal('delete-chat', c.id)}
                        className="icon-btn w-8 h-8 hover:!text-danger"
                        title="Delete"
                        aria-label="Delete conversation"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </motion.div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
