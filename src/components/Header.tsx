import { Command } from 'lucide-react';
import { useApp } from '../lib/store';
import { ModelSelector } from './ModelSelector';
import { cn } from '../lib/cn';

import { MetaIoidMark } from './brand';

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const { status, statusText, setPaletteOpen } = useApp();
  const busy = status !== 'idle' && status !== 'error';
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 h-16 flex items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <MetaIoidMark size={18} />
            <h1 className="text-[15px] font-semibold tracking-tight text-[var(--fg)] truncate">{title}</h1>
            {busy && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                {statusText}
              </span>
            )}
          </div>
          {subtitle && <p className="text-[12px] text-[var(--fg-muted)] truncate mt-0.5">{subtitle}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors"
            aria-label="Open command palette"
            title="Commands"
          >
            <kbd className="font-mono text-[10.5px] bg-[var(--surface-sunken)] border border-[var(--border)] rounded px-1.5 py-0.5 flex items-center gap-1">
              <Command size={10} />K
            </kbd>
          </button>
          <div className="hidden md:block"><ModelSelector compact /></div>
        </div>
      </div>
    </header>
  );
}
