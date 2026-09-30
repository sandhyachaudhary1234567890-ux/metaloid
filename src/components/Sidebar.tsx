import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Settings, ChevronLeft, ChevronRight,
  Plus, FolderKanban, Library, ListTodo, MoreHorizontal,
  Pencil, Trash2, User, Code2
} from 'lucide-react';
import { useApp } from '../lib/store';
import type { ViewId } from '../lib/types';
import { cn } from '../lib/cn';
import { MetaIoidMark, MetaIoidLockup } from './brand';

const NAV: { id: ViewId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
];

export function LiveIndicator({ compact = false }: { compact?: boolean }) {
  const { connection, recheckConnection } = useApp();

  if (connection === 'online') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[var(--fg-muted)]', compact ? 'text-[10px]' : 'text-[11px]', 'font-medium tracking-wide')}>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>LIVE</span>
      </span>
    );
  }
  if (connection === 'checking') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-amber-500/80', compact ? 'text-[10px]' : 'text-[11px]', 'font-medium tracking-wide')}>
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span>CHECKING</span>
      </span>
    );
  }
  return (
    <button
      onClick={() => recheckConnection()}
      title="Backend disconnected. Click to recheck."
      className={cn('inline-flex items-center gap-1.5 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors', compact ? 'text-[10px]' : 'text-[11px]', 'font-medium')}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--fg-subtle)]" />
      <span>LOCAL DEMO</span>
    </button>
  );
}

export const ConnectionPill = LiveIndicator;

export function Sidebar() {
  const {
    view, setView, sidebarCollapsed, setSidebarCollapsed,
    newConversation, conversations, selectConversation, activeId,
    openModal, renameConversation,
  } = useApp();

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Group conversations into Today, Yesterday, and Previous 7 Days
  const groupedChats = useMemo(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const today: typeof conversations = [];
    const yesterday: typeof conversations = [];
    const previous: typeof conversations = [];

    conversations.forEach((c) => {
      const age = now - (c.updatedAt || c.createdAt);
      if (age < oneDay) today.push(c);
      else if (age < 2 * oneDay) yesterday.push(c);
      else previous.push(c);
    });

    return [
      { label: 'Today', items: today },
      { label: 'Yesterday', items: yesterday },
      { label: 'Previous 7 days', items: previous.slice(0, 15) },
    ].filter((g) => g.items.length > 0);
  }, [conversations]);

  if (sidebarCollapsed) {
    return (
      <aside className="hidden md:flex w-[68px] shrink-0 flex-col items-center py-4 border-r border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--fg)]" aria-label="Primary">
        <button onClick={() => setView('chat')} aria-label="MetaIoid home" title="Home" className="hover:scale-105 transition-transform my-1">
          <MetaIoidMark size={28} />
        </button>
        <div className="mt-2 mb-4">
          <LiveIndicator compact />
        </div>
        <nav className="flex flex-col gap-1.5" aria-label="Collapsed navigation">
          <button
            title="New Chat"
            aria-label="New Chat"
            onClick={() => { newConversation(); setView('chat'); }}
            className="w-10 h-10 rounded-xl flex items-center justify-center border border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover)] text-[var(--fg)] shadow-xs transition-all"
          >
            <Plus size={17} strokeWidth={2.2} />
          </button>
          {NAV.map((n) => (
            <button
              key={n.id} title={n.label} aria-label={n.label} onClick={() => setView(n.id)}
              className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-all',
                view === n.id ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]/30' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
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
              view === 'settings' ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]/30' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
          >
            <Settings size={18} strokeWidth={1.8} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden md:flex w-[256px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--fg)] select-none" aria-label="Primary">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MetaIoidLockup variant="full" size="md" />
            <span className="text-[var(--border)]">|</span>
            <LiveIndicator />
          </div>
          <button onClick={() => setSidebarCollapsed(true)} className="icon-btn w-7 h-7 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)]" aria-label="Collapse sidebar" title="Collapse">
            <ChevronLeft size={15} />
          </button>
        </div>

        {/* Refined Integrated New Chat Button */}
        <button
          onClick={() => { newConversation(); setView('chat'); }}
          className="w-full mt-3.5 h-9 px-3.5 rounded-xl text-[13px] font-medium inline-flex items-center justify-between border border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] text-[var(--fg)] shadow-xs transition-all active:scale-[0.99]"
        >
          <span className="flex items-center gap-2">
            <Plus size={15} strokeWidth={2.2} className="text-[var(--accent)]" />
            <span>New chat</span>
          </span>
          <kbd className="font-mono text-[10px] text-[var(--fg-muted)] border border-[var(--border)] rounded px-1.5 py-0.5">⌘N</kbd>
        </button>
      </div>

      <nav className="px-3 space-y-0.5" aria-label="Main navigation">
        {NAV.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id} onClick={() => setView(n.id)}
              className={cn('w-full flex items-center gap-2.5 px-3 h-8.5 rounded-lg text-[13px] font-medium transition-all relative',
                active ? 'bg-[var(--surface-elevated)] text-[var(--fg)] shadow-xs' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
            >
              {active && <motion.span layoutId="nav-pill" className="absolute left-1 top-2 bottom-2 w-[2px] rounded-full bg-[var(--accent)]" />}
              <n.icon size={15} strokeWidth={active ? 2 : 1.8} className={active ? 'text-[var(--accent)]' : 'text-[var(--fg-muted)]'} />
              <span>{n.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Grouped Recent Chats */}
      <div className="px-3 mt-4 flex-1 overflow-y-auto min-h-0 space-y-4">
        {groupedChats.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[11px] font-semibold text-[var(--fg-muted)] tracking-wider">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((c) => {
                const isSelected = view === 'chat' && activeId === c.id;
                const isMenuOpen = activeMenuId === c.id;
                return (
                  <div key={c.id} className="relative group">
                    <button
                      onClick={() => {
                        selectConversation(c.id);
                        setView('chat');
                      }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 rounded-lg text-[12.5px] truncate transition-colors block pr-8',
                        isSelected
                          ? 'bg-[var(--surface-elevated)] text-[var(--fg)] font-medium shadow-xs'
                          : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]'
                      )}
                      title={c.title}
                    >
                      {c.title || 'Untitled conversation'}
                    </button>

                    {/* Contextual Action Trigger */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(isMenuOpen ? null : c.id);
                      }}
                      className={cn(
                        'absolute right-1.5 top-1/2 -translate-y-1/2 icon-btn w-6 h-6 rounded text-[var(--fg-muted)] hover:text-[var(--fg)] transition-opacity',
                        isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                      aria-label="Chat options"
                    >
                      <MoreHorizontal size={13} />
                    </button>

                    {/* Context Menu */}
                    <AnimatePresence>
                      {isMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setActiveMenuId(null)} />
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute right-0 top-full mt-1 z-50 w-36 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-pop p-1"
                          >
                            <button
                              onClick={() => {
                                setActiveMenuId(null);
                                openModal('rename-chat', { name: c.title, onRename: (t: string) => renameConversation(c.id, t) });
                              }}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-[var(--fg)] hover:bg-[var(--surface-hover)]"
                            >
                              <Pencil size={12} /> Rename
                            </button>
                            <button
                              onClick={() => {
                                setActiveMenuId(null);
                                openModal('delete-chat', c.id);
                              }}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-red-400 hover:bg-red-500/10"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom User & Settings Area */}
      <div className="mt-auto px-3 py-3 border-t border-[var(--border-subtle)] space-y-1">
        <button
          onClick={() => setView('settings')}
          className={cn('w-full flex items-center gap-2.5 px-3 h-8.5 rounded-lg text-[13px] font-medium transition-colors',
            view === 'settings' ? 'bg-[var(--surface-elevated)] text-[var(--fg)] shadow-xs' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]'
          )}
        >
          <Settings size={15} />
          <span>Settings</span>
        </button>

        {/* User Account Row */}
        <div className="flex items-center justify-between px-3 py-2 rounded-lg text-[13px]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-6 h-6 rounded-full bg-[var(--accent)]/15 border border-[var(--accent)]/30 flex items-center justify-center text-[var(--accent)] text-[11px] font-bold">
              A
            </span>
            <span className="font-medium text-[var(--fg)] truncate text-[12.5px]">Aryan</span>
          </div>
          <span className="text-[10px] font-mono text-[var(--fg-subtle)]">Free</span>
        </div>
      </div>
    </aside>
  );
}
