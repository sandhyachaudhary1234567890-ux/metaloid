import { motion } from 'framer-motion';
import { Home, MessageSquare, Radio, Brain, History, Settings, ChevronLeft, ChevronRight, Plus, ArrowRight } from 'lucide-react';
import { useApp } from '../lib/store';
import type { ViewId } from '../lib/types';
import { cn } from '../lib/cn';
import { MetaIoidMark, MetaIoidLockup } from './brand';

// Linear-grade sidebar navigation:
// Clear hierarchy, quiet connection indicator, high contrast, clean typography.

const NAV: { id: ViewId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'live', label: 'Live Camera', icon: Radio },
  { id: 'memory', label: 'Memory Vault', icon: Brain },
  { id: 'history', label: 'History', icon: History },
];

export function ConnectionPill({ compact = false }: { compact?: boolean }) {
  const { connection, recheckConnection } = useApp();
  if (connection === 'online') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-400', compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]', 'font-semibold tracking-wider')}>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> ONLINE
      </span>
    );
  }
  if (connection === 'checking') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 text-amber-300', compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]', 'font-semibold tracking-wider')}>
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" /> CHECKING
      </span>
    );
  }
  return (
    <button
      onClick={() => recheckConnection()}
      title="Backend not configured — running local demo. Click to retry."
      className={cn('inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--border-strong)] transition-colors', compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]', 'font-semibold tracking-wider')}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--fg-muted)]" /> LOCAL DEMO
    </button>
  );
}

export function Sidebar() {
  const { view, setView, settings, status, sidebarCollapsed, setSidebarCollapsed, newConversation, setToolsOpen } = useApp();

  if (sidebarCollapsed) {
    return (
      <aside className="hidden md:flex w-[68px] shrink-0 flex-col items-center py-4 border-r border-[var(--border)] bg-[var(--surface)] text-[var(--fg)]" aria-label="Primary">
        <button onClick={() => setView('home')} aria-label="MetaIoid home" title="Home" className="hover:scale-105 transition-transform my-1">
          <MetaIoidMark size={28} />
        </button>
        <div className="mt-3 mb-4"><ConnectionPill compact /></div>
        <nav className="flex flex-col gap-1.5" aria-label="Collapsed navigation">
          {NAV.map((n) => (
            <button
              key={n.id} title={n.label} aria-label={n.label} onClick={() => setView(n.id)}
              className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-all',
                view === n.id ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
            >
              <n.icon size={18} strokeWidth={1.8} />
            </button>
          ))}
          <button title="Agents & tools" aria-label="Agents and tools" onClick={() => setToolsOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]">
            <Plus size={18} />
          </button>
        </nav>
        <div className="mt-auto flex flex-col gap-1.5 items-center">
          <button title="Expand sidebar" aria-label="Expand sidebar" onClick={() => setSidebarCollapsed(false)} className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]">
            <ChevronRight size={17} />
          </button>
          <button title="Settings" aria-label="Settings" onClick={() => setView('settings')}
            className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
              view === 'settings' ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
          >
            <Settings size={18} strokeWidth={1.8} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden md:flex w-[256px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] select-none" aria-label="Primary">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <MetaIoidLockup variant="full" size="md" />
          <button onClick={() => setSidebarCollapsed(true)} className="icon-btn w-7 h-7" aria-label="Collapse sidebar" title="Collapse">
            <ChevronLeft size={15} />
          </button>
        </div>
        <div className="mt-2.5"><ConnectionPill compact /></div>
        <button onClick={() => { newConversation(); setView('chat'); }} className="btn-primary w-full mt-4 h-9 text-[13px]">
          <Plus size={15} /> New chat
        </button>
      </div>

      <nav className="px-3 space-y-1" aria-label="Main navigation">
        {NAV.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id} onClick={() => setView(n.id)}
              className={cn('w-full flex items-center gap-3 px-3 h-9 rounded-xl text-[13.5px] font-medium transition-all relative',
                active ? 'bg-[var(--surface-elevated)] text-[var(--fg)] border border-[var(--border)] shadow-sm' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
            >
              {active && <motion.span layoutId="nav-pill" className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-full bg-[var(--accent)]" />}
              <n.icon size={16} strokeWidth={active ? 2 : 1.8} />
              {n.label}
              {n.id === 'live' && (
                <span className="ml-auto text-[9.5px] font-bold tracking-wider text-[var(--fg-muted)] border border-[var(--border)] rounded px-1.5 py-0.2">CAM</span>
              )}
            </button>
          );
        })}
        <button onClick={() => setToolsOpen(true)} className="w-full flex items-center gap-3 px-3 h-9 rounded-xl text-[13.5px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors">
          <Plus size={16} /> Agents & tools
        </button>
      </nav>

      <div className="mt-auto px-3 pb-4 space-y-2">
        <button onClick={() => setView('settings')} className={cn('w-full flex items-center gap-3 px-3 h-9 rounded-xl text-[13.5px] transition-colors', view === 'settings' ? 'bg-[var(--surface-elevated)] text-[var(--fg)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}>
          <Settings size={16} /> Settings
        </button>

        {/* Local device status pill */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-left">
          <div className="flex items-center justify-between text-[11.5px] text-[var(--fg-muted)]">
            <span>Local Device Storage</span>
            <span className="font-mono text-[10.5px] text-[var(--accent)]">Synced</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">Conversations & memories are local</p>
        </div>
      </div>
    </aside>
  );
}
