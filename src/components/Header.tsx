import { Search, Plus, Command, Smartphone } from 'lucide-react';
import { useApp } from '../lib/store';
import { LanguageSelector } from './LanguageSelector';
import { ModelSelector } from './ModelSelector';
import { cn } from '../lib/cn';

import { MetaIoidMark } from './brand';

export function Header({ title, subtitle, onNew, onDeviceMorph }: { title: string; subtitle?: string; onNew?: () => void; onDeviceMorph?: () => void }) {
  const { status, statusText, setPaletteOpen, settings } = useApp();
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 h-16 flex items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <MetaIoidMark size={18} />
            <h1 className="text-[15px] font-semibold tracking-tight text-[var(--fg)] truncate">{title}</h1>
            <span className={cn(
              'hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-0.5 border',
              status === 'error'
                ? 'text-red-400 border-red-500/25 bg-red-500/10'
                : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10'
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full', status === 'error' ? 'bg-red-400' : 'bg-emerald-400 animate-pulse')} />
              {status === 'idle' ? 'Ready' : statusText}
            </span>
          </div>
          {subtitle && <p className="text-[12px] text-[var(--fg-muted)] truncate mt-0.5">{subtitle} &middot; {settings.agentName}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-all"
            aria-label="Open command palette"
          >
            <Search size={13} /> <span className="hidden lg:inline">Search commands…</span>
            <kbd className="font-mono text-[10.5px] bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-1.5 py-0.2 flex items-center gap-1"><Command size={10} />K</kbd>
          </button>
          <div className="hidden md:block"><ModelSelector compact /></div>
          <LanguageSelector compact />
          {onDeviceMorph && (
            <button
              onClick={onDeviceMorph}
              className="icon-btn w-8 h-8 rounded-lg hover:text-[var(--accent)]"
              title="Showcase 360° Morphing Device (4s)"
              aria-label="360 Device Showcase"
            >
              <Smartphone size={15} />
            </button>
          )}
          {onNew && (
            <button onClick={onNew} className="btn-primary h-8 px-3 text-[12.5px]" aria-label="New chat">
              <Plus size={14} /> <span className="hidden sm:inline">New</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function ConnectionDot() {
  const { status } = useApp();
  return (
    <span className="flex items-center gap-2 text-[12px] text-[var(--fg-muted)]">
      <span className={cn('w-1.5 h-1.5 rounded-full', status === 'error' ? 'bg-red-400' : 'bg-emerald-400')} />
      {status === 'error' ? 'Connection unavailable' : 'Local prototype'}
    </span>
  );
}
