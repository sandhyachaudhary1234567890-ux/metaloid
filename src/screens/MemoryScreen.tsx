import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Search, Trash2, Pencil, X, Brain } from 'lucide-react';
import { useApp } from '../lib/store';
import type { MemoryCategory, MemoryItem } from '../lib/types';
import { timeAgo, cn } from '../lib/cn';

// MEMORY — local persistent user context.
// Curated categories: Personal, Preferences, Projects, Important, Instructions.

const CATS: MemoryCategory[] = ['Personal', 'Preferences', 'Projects', 'Important', 'Instructions'];
const CAT_COLOR: Record<MemoryCategory, string> = {
  Personal: 'text-sky-400 bg-sky-400/10 border-sky-400/20',
  Preferences: 'text-violet-400 bg-violet-400/10 border-violet-400/20',
  Projects: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
  Important: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  Instructions: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
};

export function MemoryScreen() {
  const { memories, addMemory, updateMemory, openModal, toast, settings } = useApp();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'All' | MemoryCategory>('All');
  const [selected, setSelected] = useState<MemoryItem | null>(null);
  const [draft, setDraft] = useState('');
  const [draftCat, setDraftCat] = useState<MemoryCategory>('Personal');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const filtered = useMemo(() => {
    return memories.filter((m) => {
      if (filter !== 'All' && m.category !== filter) return false;
      if (q && !m.content.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [memories, filter, q]);

  const groups = useMemo(() => {
    const out: { label: MemoryCategory; items: MemoryItem[] }[] = [];
    (['Projects', 'Preferences', 'Personal', 'Instructions', 'Important'] as MemoryCategory[]).forEach((c) => {
      const items = filtered.filter((m) => m.category === c);
      if (items.length) out.push({ label: c, items });
    });
    return out;
  }, [filtered]);

  const save = () => {
    if (!draft.trim() || !settings.memoryEnabled) return;
    addMemory(draft.trim(), draftCat);
    setDraft('');
    setAdding(false);
    toast({ title: 'Memory saved', desc: 'Preserved locally on this device' });
  };

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-8 py-6 pb-32 md:pb-12 text-[var(--fg)]">
      <div className="flex items-start gap-4 flex-wrap">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-[var(--fg)]">Memory Vault</h2>
          <p className="text-[13.5px] text-[var(--fg-muted)] mt-0.5">Durable local context remembered by {settings.agentName}.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={cn('chip !text-[12px]', settings.memoryEnabled ? '' : 'opacity-60')}>
            <span className={cn('w-1.5 h-1.5 rounded-full', settings.memoryEnabled ? 'bg-emerald-400' : 'bg-[var(--fg-muted)]')} />
            {settings.memoryEnabled ? 'Active · on-device' : 'Paused'}
          </span>
          <button onClick={() => setAdding(true)} disabled={!settings.memoryEnabled} className="btn-primary h-9 px-3.5 text-[13px] disabled:opacity-40">
            <Plus size={14} /> Add memory
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
        <div className="flex-1 flex items-center gap-2.5 input-shell px-3.5 h-10">
          <Search size={15} className="text-[var(--fg-muted)] shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search memories…"
            className="flex-1 bg-transparent outline-none text-[13.5px] placeholder:text-[var(--fg-subtle)] text-[var(--fg)]"
            aria-label="Search memories"
          />
          {q && <button onClick={() => setQ('')} className="icon-btn w-6 h-6" aria-label="Clear search"><X size={13} /></button>}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(['All', ...CATS] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              aria-pressed={filter === c}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all min-h-[34px]',
                filter === c
                  ? 'bg-[var(--surface-elevated)] border-[var(--accent)] text-[var(--fg)] shadow-sm'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] mt-5 p-12 text-center">
          <Brain size={26} className="mx-auto text-[var(--fg-muted)]" />
          <p className="mt-3 text-[14.5px] font-medium text-[var(--fg)]">No memories found.</p>
          <p className="text-[12.5px] text-[var(--fg-muted)] mt-1">Say &ldquo;Remember that I prefer concise answers&rdquo; in chat or add one manually.</p>
          {settings.memoryEnabled && (
            <button onClick={() => setAdding(true)} className="btn-ghost h-9 px-4 text-[13px] mt-4">
              <Plus size={14} /> Add memory
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((g) => (
            <section key={g.label}>
              <div className="text-[11.5px] font-semibold tracking-wider uppercase text-[var(--fg-muted)] mb-2.5">
                {g.label} &middot; {g.items.length}
              </div>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {g.items.map((m, i) => (
                  <motion.button
                    key={m.id}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    onClick={() => { setSelected(m); setEditing(false); setEditText(m.content); }}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] transition-all"
                  >
                    <span className={cn('inline-flex text-[10px] font-bold tracking-wider uppercase rounded-md px-2 py-0.5 border', CAT_COLOR[m.category])}>
                      {m.category}
                    </span>
                    <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--fg)] line-clamp-3">{m.content}</p>
                    <div className="mt-2.5 text-[11.5px] text-[var(--fg-subtle)]">{timeAgo(m.createdAt)}</div>
                  </motion.button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* add modal */}
      <AnimatePresence>
        {adding && (
          <>
            <motion.div className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-xs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAdding(false)} />
            <motion.div
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
              className="fixed bottom-0 sm:bottom-8 inset-x-0 sm:inset-x-auto sm:right-8 sm:w-[420px] z-[76] rounded-t-3xl sm:rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-pop text-[var(--fg)]"
            >
              <h3 className="text-[15px] font-semibold text-[var(--fg)]">Add memory</h3>
              <p className="text-[12px] text-[var(--fg-muted)] mt-0.5">Durable preferences, project context, or instructions.</p>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder="e.g. Prefers concise answers and unit test diffs…"
                className="mt-3.5 w-full rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] p-3 text-[13.5px] text-[var(--fg)] outline-none focus:border-[var(--accent)] resize-none"
                autoFocus
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {CATS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setDraftCat(c)}
                    aria-pressed={draftCat === c}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition-all',
                      draftCat === c
                        ? 'bg-[var(--surface)] border-[var(--accent)] text-[var(--fg)]'
                        : 'border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--fg-muted)]'
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => setAdding(false)} className="btn-ghost h-9 text-[13px]">Cancel</button>
                <button onClick={save} disabled={!draft.trim()} className="btn-primary h-9 text-[13px] disabled:opacity-40">Save memory</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* detail panel */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div className="fixed inset-0 z-[75] bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelected(null)} />
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 z-[76] w-full sm:w-[400px] border-l border-[var(--border)] bg-[var(--surface-elevated)] p-5 overflow-y-auto text-[var(--fg)]"
              role="dialog" aria-label="Memory detail"
            >
              <button onClick={() => setSelected(null)} className="icon-btn w-8 h-8 ml-auto flex" aria-label="Close memory detail"><X size={16} /></button>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)] mt-1">Memory Entry</div>
              {editing ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={4}
                  className="mt-3 w-full rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] p-3 text-[14px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
              ) : (
                <p className="mt-3 text-[15px] leading-relaxed font-medium text-[var(--fg)]">&ldquo;{selected.content}&rdquo;</p>
              )}
              <div className="mt-4 space-y-2.5 text-[12.5px]">
                <div className="flex justify-between border-b border-[var(--border-subtle)] pb-2"><span className="text-[var(--fg-muted)]">Category</span><span className="font-medium text-[var(--fg)]">{selected.category}</span></div>
                <div className="flex justify-between border-b border-[var(--border-subtle)] pb-2"><span className="text-[var(--fg-muted)]">Saved</span><span className="font-medium text-[var(--fg)]">{new Date(selected.createdAt).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-[var(--fg-muted)]">Storage</span><span className="font-medium text-[var(--fg)]">Local on device</span></div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {editing ? (
                  <>
                    <button onClick={() => setEditing(false)} className="btn-ghost h-9 text-[13px]">Cancel</button>
                    <button onClick={() => { updateMemory(selected.id, { content: editText }); setSelected({ ...selected, content: editText }); setEditing(false); toast({ title: 'Memory updated' }); }} className="btn-primary h-9 text-[13px]">Save</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditing(true)} className="btn-ghost h-9 text-[13px]"><Pencil size={13} /> Edit</button>
                    <button onClick={() => { openModal('delete-memory', selected.id); setSelected(null); }} className="btn-danger h-9 text-[13px]"><Trash2 size={13} /> Delete</button>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
