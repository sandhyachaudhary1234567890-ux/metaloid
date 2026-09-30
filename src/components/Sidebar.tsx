import { motion } from 'framer-motion';
import { Home, MessageSquare, Radio, Brain, History, Settings, ChevronLeft, ChevronRight, Plus, FolderKanban, Library, Telescope, ListTodo, MessageSquarePlus } from 'lucide-react';
import { useApp } from '../lib/store';
import type { ViewId } from '../lib/types';
import { cn } from '../lib/cn';
import { MetaIoidMark, MetaIoidLockup } from './brand';

const NAV: { id: ViewId; label: string; icon: typeof Home }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
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
  const {
    view, setView, sidebarCollapsed, setSidebarCollapsed,
    newConversation, conversations, selectConversation, activeId,
  } = useApp();

  const recentChats = conversations.slice(0, 5);

  if (sidebarCollapsed) {
    return (
      <aside className="hidden md:flex w-[68px] shrink-0 flex-col items-center py-4 border-r border-[var(--border)] bg-[var(--surface)] text-[var(--fg)]" aria-label="Primary">
        <button onClick={() => setView('chat')} aria-label="MetaIoid home" title="Home" className="hover:scale-105 transition-transform my-1">
          <MetaIoidMark size={28} />
        </button>
        <div className="mt-3 mb-4"><ConnectionPill compact /></div>
        <nav className="flex flex-col gap-1.5" aria-label="Collapsed navigation">
          <button
            title="New Chat"
            aria-label="New Chat"
            onClick={() => { newConversation(); setView('chat'); }}
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent)] text-white shadow-sm hover:opacity-95 transition-all"
          >
            <Plus size={18} strokeWidth={2.2} />
          </button>
          {NAV.map((n) => (
            <button
              key={n.id} title={n.label} aria-label={n.label} onClick={() => setView(n.id)}
              className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-all',
                view === n.id ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
            >
              <n.icon size={18} strokeWidth={1.8} />
            </button>
          ))}
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
    <aside className="hidden md:flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] select-none" aria-label="Primary">
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <MetaIoidLockup variant="full" size="md" />
          <button onClick={() => setSidebarCollapsed(true)} className="icon-btn w-7 h-7" aria-label="Collapse sidebar" title="Collapse">
            <ChevronLeft size={15} />
          </button>
        </div>
        <div className="mt-2.5"><ConnectionPill compact /></div>
        <button onClick={() => { newConversation(); setView('chat'); }} className="btn-primary w-full mt-4 h-9 text-[13px] rounded-xl font-medium inline-flex items-center justify-center gap-2">
          <Plus size={16} strokeWidth={2} /> New chat
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
            </button>
          );
        })}
      </nav>

      {/* Recent Chats Section */}
      {recentChats.length > 0 && (
        <div className="px-3 mt-4 flex-1 overflow-y-auto">
          <p className="px-3 pb-1.5 text-[10.5px] font-bold tracking-[0.14em] uppercase text-[var(--fg-muted)]">
            Recent Chats
          </p>
          <div className="space-y-0.5">
            {recentChats.map((c) => {
              const isSelected = view === 'chat' && activeId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    selectConversation(c.id);
                    setView('chat');
                  }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 rounded-lg text-xs truncate transition-colors block',
                    isSelected
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-medium'
                      : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]'
                  )}
                  title={c.title}
                >
                  {c.title || 'Untitled conversation'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-auto px-3 pb-4 space-y-2">
        <button onClick={() => setView('settings')} className={cn('w-full flex items-center gap-3 px-3 h-9 rounded-xl text-[13.5px] transition-colors', view === 'settings' ? 'bg-[var(--surface-elevated)] text-[var(--fg)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}>
          <Settings size={16} /> Settings
        </button>

        {/* Local Persistence Pill */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-2.5 text-left">
          <div className="flex items-center justify-between text-[11px] text-[var(--fg-muted)] font-medium">
            <span>MetaIoid Platform</span>
            <span className="font-mono text-[10px] text-[var(--fg-muted)]">v0.1.0</span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-[var(--fg-subtle)]">Unified Chat & Workspaces</p>
        </div>
      </div>
    </aside>
  );
}
