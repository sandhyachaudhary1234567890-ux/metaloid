import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Pin, Pencil, Trash2, MessageSquare, Plus, X } from 'lucide-react';
import { useApp } from '../lib/store';
import { groupConversations, timeAgo, cn } from '../lib/cn';

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
  const { conversations, selectConversation, deleteConversation, pinConversation, renameConversation, openModal, newConversation, setView } = useApp();
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  const filtered = useMemo(() => {
    const list = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q.trim()) return list;
    return list.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()) || (c.preview ?? '').toLowerCase().includes(q.toLowerCase()));
  }, [conversations, q]);

  const groups = groupConversations(filtered);

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-8 py-6 pb-32 md:pb-12">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight text-[var(--fg)]">History</h2>
          <p className="text-[13px] text-[var(--fg-muted)] mt-0.5">{conversations.length} conversations · on this device</p>
        </div>
        <button onClick={() => { newConversation(); setView('chat'); }} className="btn-primary h-10 px-3.5 text-[13px] ml-auto min-h-[40px]">
          <Plus size={15} /> New chat
        </button>
      </div>

      <div className="mt-5 flex items-center gap-2.5 input-shell px-3.5 h-10">
        <Search size={15} className="text-[var(--fg-muted)] shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations…"
          className="flex-1 bg-transparent outline-none text-[13.5px] text-[var(--fg)] placeholder:text-[var(--fg-muted)]"
          aria-label="Search conversations"
        />
        {q && <button onClick={() => setQ('')} className="icon-btn w-6 h-6" aria-label="Clear"><X size={13} /></button>}
      </div>

      {filtered.length === 0 ? (
        <div className="surface mt-5 p-12 text-center">
          <MessageSquare size={24} className="mx-auto text-[var(--fg-muted)]" />
          <p className="mt-3 text-[14.5px] font-medium text-[var(--fg)]">{q ? 'No conversations found.' : 'Your conversations will appear here.'}</p>
          <p className="text-[12.5px] text-[var(--fg-muted)] mt-1">{q ? 'Try a different search.' : 'Return anytime — history stays on this device.'}</p>
        </div>
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
                      <span className="flex items-center gap-2 text-[14px] font-medium text-[var(--fg)] truncate">
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
                            className="bg-[var(--surface-sunken)] border border-[var(--border)] rounded-lg px-2 py-1 text-[13.5px] text-[var(--fg)] outline-none w-full focus:border-[var(--accent)]"
                            autoFocus
                            aria-label="Conversation title"
                          />
                        ) : highlight(c.title, q)}
                      </span>
                      <span className="block text-[12px] text-[var(--fg-muted)] mt-0.5 truncate">{c.preview || `${c.messages.length} messages`}</span>
                      <span className="block text-[11px] text-[var(--fg-subtle)] mt-0.5">{timeAgo(c.updatedAt)} · {c.model}</span>
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
                        className="icon-btn w-8 h-8 hover:!text-red-400"
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
