import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Check, Globe } from 'lucide-react';
import { LANGUAGES, languageLabel, languageShort } from '../lib/i18n';
import { useApp } from '../lib/store';
import type { LanguageId } from '../lib/types';
import { cn } from '../lib/cn';

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, detectedLang, toast } = useApp();
  const [open, setOpen] = useState(false);

  const pick = (id: LanguageId) => {
    setLanguage(id);
    setOpen(false);
    toast({ title: id === 'auto' ? 'Language set to Auto Detect' : `Language changed to ${languageLabel(id)}` });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] hover:bg-[var(--surface-hover)] text-[var(--fg)] transition-all',
          compact ? 'h-8 px-2.5 text-[12px]' : 'h-9 px-3 text-[13px]'
        )}
        aria-haspopup="listbox" aria-expanded={open} aria-label="Select language"
      >
        <Globe size={14} className="text-[var(--fg-muted)]" />
        <span className="text-left leading-none">
          <span className="block text-[8.5px] font-bold tracking-wider uppercase text-[var(--fg-muted)]">LANGUAGE</span>
          <span className="block font-medium text-[var(--fg)] mt-0.5">{language === 'auto' ? 'AUTO' : languageShort(language)}</span>
        </span>
        <ChevronDown size={13} className={cn('text-[var(--fg-muted)] transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-11 z-50 w-[240px] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg)] shadow-pop p-1.5 max-h-[340px] overflow-y-auto"
              role="listbox" aria-label="Languages"
            >
              {LANGUAGES.map((l) => {
                const active = language === l.id;
                return (
                  <button
                    key={l.id}
                    role="option" aria-selected={active}
                    onClick={() => pick(l.id as LanguageId)}
                    className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors', active ? 'bg-[var(--surface-hover)] border border-[var(--border)]' : 'hover:bg-[var(--surface-hover)]')}
                  >
                    <span className="w-9 text-[11.5px] font-mono text-[var(--fg-muted)]">{l.short}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-[var(--fg)] truncate">{l.label}</span>
                      <span className="block text-[11.5px] text-[var(--fg-muted)] truncate">{l.native}</span>
                    </span>
                    {active && <Check size={14} className="text-[var(--accent)]" />}
                  </button>
                );
              })}
              {detectedLang && (
                <div className="px-3 py-2 text-[11.5px] text-[var(--fg-muted)] border-t border-[var(--border-subtle)] mt-1">
                  Detected: <span className="text-[var(--fg)] font-medium">{detectedLang}</span>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
