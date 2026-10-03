import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Check, RefreshCw } from 'lucide-react';
import { MODELS, modelLabel } from '../lib/i18n';
import { getModels, type LiveModel } from '../lib/transport';
import { useApp } from '../lib/store';
import type { ModelId } from '../lib/types';
import { cn } from '../lib/cn';

// Tier preference (fast/balanced/smart/vision) + live free-model engine.
export function ModelSelector({ compact = false }: { compact?: boolean }) {
  const { model, setModel, toast, connection, settings } = useApp();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<LiveModel[] | null>(null);
  // Any reachable gateway can list models — sandbox and degraded included.
  // Only a genuinely unreachable backend has nothing to show.
  const reachable = connection === 'online' || connection === 'mock' || connection === 'degraded';
  const online = reachable;

  const refresh = async () => {
    const m = await getModels(settings.backendUrl);
    setLive(m);
  };

  useEffect(() => {
    if (open && online && !live) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, online]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-full text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors',
          compact ? 'h-7 px-2 text-[11.5px]' : 'h-8 px-2.5 text-[12.5px]'
        )}
        aria-haspopup="listbox" aria-expanded={open} aria-label="Select model"
      >
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', online ? 'bg-emerald-400' : 'bg-[var(--fg-subtle)]')} title={online ? 'Connected' : 'Local demo'} />
        <span className="font-medium whitespace-nowrap">MetaIoid · {modelLabel(model)}</span>
        <ChevronDown size={12} className={cn('text-[var(--fg-muted)] transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-11 z-50 w-[300px] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg)] shadow-pop p-1.5 max-h-[400px] overflow-y-auto"
              role="listbox" aria-label="Models"
            >
              <div className="px-3 pt-2 pb-1.5">
                <div className="text-[12.5px] font-medium text-[var(--fg)]">MetaIoid · {modelLabel(model)}</div>
                <div className="text-[11.5px] text-[var(--fg-muted)] mt-0.5">
                  {online ? `Answers come from ${settings.backendUrl ? 'your gateway' : 'the connected gateway'}` : 'No AI connected — local demo replies'}
                </div>
              </div>
              <div className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">How MetaIoid should think</div>
              {MODELS.map((m) => {
                const active = model === m.id;
                return (
                  <button
                    key={m.id} role="option" aria-selected={active}
                    onClick={() => { setModel(m.id as ModelId); setOpen(false); toast({ title: `Model set to ${m.label}` }); }}
                    className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors', active ? 'bg-[var(--surface-hover)] border border-[var(--border)]' : 'hover:bg-[var(--surface-hover)]')}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-[var(--fg)] truncate">{m.label}</span>
                      <span className="block text-[11.5px] text-[var(--fg-muted)] truncate">{m.desc}</span>
                    </span>
                    {active && <Check size={14} className="text-[var(--accent)]" />}
                  </button>
                );
              })}
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)] flex items-center gap-2">
                Live engine
                {online && (
                  <button onClick={refresh} className="icon-btn w-5 h-5" aria-label="Refresh model list"><RefreshCw size={11} /></button>
                )}
              </div>
              {online ? (
                live?.length ? (
                  live.slice(0, 8).map((m) => (
                    <div key={m.id} className={cn('px-3 py-1.5 rounded-lg text-left', m.unavailable && 'opacity-45')}>
                      <div className="text-[12px] font-mono text-[var(--fg)] truncate flex items-center gap-2">
                        <span className="truncate">{m.id}</span>
                        {m.unavailable && (
                          <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wider text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded px-1.5 py-0.5">unavailable</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--fg-muted)]">
                        {m.unavailable ? 'rejected by provider — skipped automatically' : `${m.tier} · routed automatically`}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-2 text-[12px] text-[var(--fg-muted)]">Loading live list…</div>
                )
              ) : (
                <div className="px-3 py-2 text-[11.5px] text-[var(--fg-muted)] border-t border-[var(--border-subtle)] mt-1">
                  Local demo mode &mdash; connect backend for live models.
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
