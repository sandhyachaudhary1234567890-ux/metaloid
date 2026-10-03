import { motion } from 'framer-motion';
import { MessageSquare, History, Telescope, Settings, ChevronLeft, ChevronRight, Plus, Archive, Library, CheckCircle2, Sparkles } from 'lucide-react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { MetaIoidMark, MetaIoidLockup } from './brand';

// Primary navigation: four destinations, nothing else.
//
// Chat is the product, so it leads; History and Research are the two things you
// reach for around a conversation; Settings holds everything configuration
// shaped (voice, memory, providers, account). Live camera lives in the
// composer, memory lives in Settings and in context — neither needs a
// permanent slot competing with the conversation.

type NavId = 'chat' | 'history' | 'research' | 'settings';

const NAV: { id: NavId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'history', label: 'History', icon: History },
  { id: 'research', label: 'Research', icon: Telescope },
];

// Master-line surfaces (workspaces, artifacts, tasks) stay reachable from the
// same shell instead of living in parallel navigation.
const WORKSPACE: { id: 'projects' | 'library' | 'tasks'; label: string; icon: typeof MessageSquare }[] = [
  { id: 'projects', label: 'Projects', icon: Archive },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'tasks', label: 'Tasks', icon: CheckCircle2 },
];

/** Quiet, honest connection state. Never says ONLINE because a variable is set. */
export function ConnectionPill({ compact = false }: { compact?: boolean }) {
  const { connection, recheckConnection, health } = useApp();
  const base = cn(
    'inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors',
    compact ? 'px-2 py-[3px] text-[10px]' : 'px-2.5 py-1 text-[11px]',
  );

  if (connection === 'online') {
    return (
      <span
        title={`Live provider: ${health?.provider || 'openrouter'}${health?.models?.free ? ` · ${health.models.free} free models` : ''}`}
        className={cn(base, 'border-emerald-500/20 text-emerald-400/90')}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> ONLINE
      </span>
    );
  }
  if (connection === 'mock') {
    return (
      <button
        onClick={() => recheckConnection()}
        title="Sandbox provider — real streaming, canned model. Everything works end to end with no API key. Add a key for live models."
        className={cn(base, 'border-violet-500/25 text-violet-300/90 hover:border-violet-400/50')}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> SANDBOX
      </button>
    );
  }
  if (connection === 'degraded') {
    return (
      <button
        onClick={() => recheckConnection()}
        title="A provider key is set but the gateway cannot reach it. Replies will fail until this clears."
        className={cn(base, 'border-amber-500/25 text-amber-300/90 hover:border-amber-400/50')}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> DEGRADED
      </button>
    );
  }
  if (connection === 'checking') {
    return (
      <span className={cn(base, 'border-[var(--border)] text-[var(--fg-muted)]')}>
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--fg-muted)] animate-pulse" /> CHECKING
      </span>
    );
  }
  return (
    <button
      onClick={() => recheckConnection()}
      title="No gateway connected — running the local demo. Click to retry."
      className={cn(base, 'border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--border-strong)]')}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--fg-muted)]" /> LOCAL DEMO
    </button>
  );
}

/** One honest line about where the user's data lives. No invented "Synced". */
function StorageLine() {
  const auth = useAuth();
  const signedIn = auth.status === 'signed-in';
  const text = !auth.configured
    ? 'Local demo · stays on this device'
    : signedIn
      ? `Syncing · ${auth.user?.email ?? 'signed in'}`
      : 'On this device · sign in to sync';
  return (
    <p className="px-3 text-[11px] leading-relaxed text-[var(--fg-subtle)]">{text}</p>
  );
}

export function Sidebar() {
  const { view, setView, sidebarCollapsed, setSidebarCollapsed, newConversation, osintOpen, setOsintOpen, setSkillsOpen } = useApp();

  const go = (id: NavId) => {
    if (id === 'research') { setOsintOpen(true); return; }
    setView(id);
  };
  const active = (id: NavId) => (id === 'research' ? osintOpen : view === id);

  if (sidebarCollapsed) {
    return (
      <aside className="hidden md:flex w-[64px] shrink-0 flex-col items-center py-4 border-r border-[var(--border)] bg-[var(--surface)] text-[var(--fg)]" aria-label="Primary">
        <button onClick={() => setView('chat')} aria-label="MetaIoid" title="Chat" className="my-1">
          <MetaIoidMark size={26} />
        </button>
        <nav className="flex flex-col gap-1 mt-4" aria-label="Collapsed navigation">
          {NAV.map((n) => (
            <button
              key={n.id} title={n.label} aria-label={n.label} onClick={() => go(n.id)}
              className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
                active(n.id) ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
            >
              <n.icon size={18} strokeWidth={1.8} />
            </button>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1 items-center">
          <button title="New chat" aria-label="New chat" onClick={() => { newConversation(); setView('chat'); }}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--surface-hover)]">
            <Plus size={18} />
          </button>
          <button title="Skills" aria-label="Skills" onClick={() => setSkillsOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]">
            <Sparkles size={17} />
          </button>
          <button title="Settings" aria-label="Settings" onClick={() => setView('settings')}
            className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
              view === 'settings' ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}>
            <Settings size={18} strokeWidth={1.8} />
          </button>
          <button title="Expand sidebar" aria-label="Expand sidebar" onClick={() => setSidebarCollapsed(false)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]">
            <ChevronRight size={17} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden md:flex w-[248px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] select-none" aria-label="Primary">
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <button onClick={() => setView('chat')} className="min-w-0" aria-label="MetaIoid home">
            <MetaIoidLockup variant="full" size="md" />
          </button>
          <button onClick={() => setSidebarCollapsed(true)} className="icon-btn w-7 h-7" aria-label="Collapse sidebar" title="Collapse">
            <ChevronLeft size={15} />
          </button>
        </div>
        <div className="mt-3"><ConnectionPill compact /></div>
        <button onClick={() => { newConversation(); setView('chat'); }} className="btn-primary w-full mt-4 h-9 text-[13px]">
          <Plus size={15} /> New chat
        </button>
      </div>

      <nav className="px-3 space-y-0.5" aria-label="Main navigation">
        {NAV.map((n) => {
          const on = active(n.id);
          return (
            <button
              key={n.id} onClick={() => go(n.id)}
              aria-current={on ? 'page' : undefined}
              className={cn('w-full flex items-center gap-3 px-3 h-10 rounded-xl text-[13.5px] font-medium transition-colors relative',
                on ? 'bg-[var(--surface-elevated)] text-[var(--fg)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
            >
              {on && <motion.span layoutId="nav-pill" className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[var(--accent)]" />}
              <n.icon size={16} strokeWidth={on ? 2 : 1.8} />
              {n.label}
            </button>
          );
        })}
      </nav>

      <nav className="px-3 mt-4" aria-label="Workspace" hidden={false}>
        <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-faint)]">Workspace</p>
        <div className="space-y-0.5">
          {WORKSPACE.map((n) => {
            const on = view === n.id;
            return (
              <button
                key={n.id} onClick={() => setView(n.id)} aria-current={on ? 'page' : undefined}
                className={cn('w-full flex items-center gap-3 px-3 h-9 rounded-xl text-[13px] transition-colors',
                  on ? 'bg-[var(--surface-elevated)] text-[var(--fg)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
              >
                <n.icon size={15} strokeWidth={on ? 2 : 1.8} />
                {n.label}
              </button>
            );
          })}
          <button
            onClick={() => setSkillsOpen(true)}
            className="w-full flex items-center gap-3 px-3 h-9 rounded-xl text-[13px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]"
          >
            <Sparkles size={15} strokeWidth={1.8} /> Skills
          </button>
        </div>
      </nav>

      <div className="mt-auto px-3 pb-4 space-y-2">
        <button
          onClick={() => setView('settings')}
          aria-current={view === 'settings' ? 'page' : undefined}
          className={cn('w-full flex items-center gap-3 px-3 h-10 rounded-xl text-[13.5px] transition-colors',
            view === 'settings' ? 'bg-[var(--surface-elevated)] text-[var(--fg)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]')}
        >
          <Settings size={16} /> Settings
        </button>
        <StorageLine />
      </div>
    </aside>
  );
}
