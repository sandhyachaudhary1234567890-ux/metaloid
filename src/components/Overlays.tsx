import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Info, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../lib/store';

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-6 z-[90] flex flex-col gap-2 items-center md:items-end pointer-events-none" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] backdrop-blur-xl pl-3.5 pr-4 py-2.5 shadow-elevated min-w-[260px] max-w-[360px]"
          >
            <span className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
              <Check size={14} className="text-emerald-400" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--fg)] leading-tight">{t.title}</span>
              {t.desc && <span className="block text-[12px] text-[var(--fg-muted)] leading-snug mt-0.5">{t.desc}</span>}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function ModalRoot() {
  const { modal, closeModal, deleteConversation, deleteMemory, clearAllData, toast, setView } = useApp();
  const [input, setInput] = useState('');

  useEffect(() => {
    const p = modal.payload as { name?: string } | string | undefined;
    setInput(typeof p === 'string' ? p : (p?.name ?? ''));
  }, [modal]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && modal.kind === 'rename-chat') confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal.kind, input]);

  if (!modal.kind) return null;

  const confirm = () => {
    if (modal.kind === 'delete-chat' && typeof modal.payload === 'string') {
      deleteConversation(modal.payload);
      toast({ title: 'Conversation deleted' });
    }
    if (modal.kind === 'delete-memory' && typeof modal.payload === 'string') {
      deleteMemory(modal.payload);
      toast({ title: 'Memory deleted' });
    }
    if (modal.kind === 'clear-data') {
      clearAllData();
      toast({ title: 'Local data cleared' });
      setView('home');
    }
    if (modal.kind === 'end-live') {
      toast({ title: 'Live session ended' });
      setView('home');
    }
    closeModal();
  };

  const titles: Record<string, { title: string; desc: string; danger?: boolean; confirmLabel?: string }> = {
    'delete-chat': { title: 'Delete conversation?', desc: 'This removes it from local history. This cannot be undone.', danger: true, confirmLabel: 'Delete' },
    'delete-memory': { title: 'Delete memory?', desc: 'Your agent will no longer remember this.', danger: true, confirmLabel: 'Delete' },
    'clear-data': { title: 'Clear local data?', desc: 'Removes settings, memories and conversations stored in this browser.', danger: true, confirmLabel: 'Clear everything' },
    'end-live': { title: 'End live session?', desc: 'The camera preview will stop. You can restart anytime.', confirmLabel: 'End session' },
    'rename-chat': { title: 'Rename conversation', desc: 'Give it a short, memorable name.', confirmLabel: 'Save' },
  };

  const meta = titles[modal.kind] ?? { title: modal.kind, desc: '' };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={meta.title}>
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeModal} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.16 }}
        className="relative w-full max-w-[390px] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-elevated p-6"
      >
        <button onClick={closeModal} className="absolute top-4 right-4 icon-btn w-7 h-7" aria-label="Close dialog"><X size={15} /></button>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border mb-4 ${meta.danger ? 'bg-red-500/10 border-red-500/25' : 'bg-[var(--accent-subtle)] border-[var(--border)]'}`}>
          {meta.danger ? <AlertTriangle size={18} className="text-red-400" /> : <Info size={18} className="text-[var(--accent)]" />}
        </div>
        <h3 className="text-[16px] font-semibold tracking-tight text-[var(--fg)]">{meta.title}</h3>
        <p className="text-[13px] text-[var(--fg-muted)] mt-1.5 leading-relaxed">{meta.desc}</p>
        {modal.kind === 'rename-chat' && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mt-4 w-full h-10 rounded-lg bg-[var(--surface-sunken)] border border-[var(--border)] px-3 text-[13.5px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
            aria-label="Conversation name"
            autoFocus
          />
        )}
        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <button onClick={closeModal} className="btn-ghost h-10 text-[13px]">Cancel</button>
          <button
            onClick={() => {
              if (modal.kind === 'rename-chat') {
                const p = modal.payload as { onRename?: (v: string) => void; name?: string } | undefined;
                if (typeof p === 'object' && p?.onRename) p.onRename(input || p.name || 'Conversation');
                toast({ title: 'Conversation renamed' });
                closeModal();
                return;
              }
              confirm();
            }}
            className={`h-10 rounded-lg text-[13px] font-medium transition-all ${meta.danger ? 'btn-danger' : 'btn-primary'}`}
          >{meta.confirmLabel ?? 'Confirm'}</button>
        </div>
      </motion.div>
    </div>
  );
}
