import { MessageSquare, History, Telescope, Settings, ChevronLeft, ChevronRight, Plus, Archive, Library, CheckCircle2, Sparkles } from 'lucide-react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { MetaIoidMark, MetaIoidLockup } from './brand';

// PRIMARY NAVIGATION
//
// Four destinations and a workspace group, nothing else. Chat leads because it
// is the product.
//
// This file previously reported gateway state in the voice of a system monitor
// — ONLINE / SANDBOX / DEGRADED / CHECKING, in caps, in the sidebar, on every
// screen. That is an engineering readout, not a product. Connection is now one
// quiet dot with a human word, and the storage/account detail it used to carry
// lives in Settings → Account where it belongs.

type NavId = 'chat' | 'history' | 'research' | 'settings';

const NAV: { id: NavId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'history', label: 'History', icon: History },
  { id: 'research', label: 'Research', icon: Telescope },
];

const WORKSPACE: { id: 'projects' | 'library' | 'tasks'; label: string; icon: typeof MessageSquare }[] = [
  { id: 'projects', label: 'Projects', icon: Archive },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'tasks', label: 'Tasks', icon: CheckCircle2 },
];

/**
 * Connection, said quietly.
 *
 * A dot and one word. The full technical story (which provider, which models,
 * what went wrong) is one click away in Settings — this is the ambient signal,
 * not the diagnostic.
 */
export function ConnectionPill({ compact = false }: { compact?: boolean }) {
  const { connection, recheckConnection, health } = useApp();

  const view = {
    online: { word: 'Connected', tone: 'var(--success)', title: `Live provider: ${health?.provider || 'openrouter'}${health?.models?.free ? ` · ${health.models.free} free models` : ''}` },
    mock: { word: 'Demo mode', tone: 'var(--info)', title: 'Sandbox provider — real streaming, canned model. Everything works end to end with no API key.' },
    degraded: { word: 'Unstable', tone: 'var(--warning)', title: 'A provider key is set but the gateway cannot reach it. Replies will fail until this clears.' },
    checking: { word: 'Connecting', tone: 'var(--fg-muted)', title: 'Checking the gateway…' },
    offline: { word: 'Offline', tone: 'var(--fg-subtle)', title: 'No gateway connected — running the local demo. Click to retry.' },
  }[connection] ?? { word: 'Offline', tone: 'var(--fg-subtle)', title: 'No gateway connected.' };

  const pulse = connection === 'checking';

  return (
    <button
      onClick={() => recheckConnection()}
      title={view.title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-transparent text-[var(--fg-muted)]',
        'transition-colors duration-small ease-out hover:border-[var(--border)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-secondary)]',
        compact ? 'px-1.5 py-[3px] text-micro font-normal tracking-normal' : 'px-2 py-1 text-small',
      )}
    >
      <span
        aria-hidden
        className={cn('shrink-0 rounded-full', pulse && 'animate-pulse-soft')}
        style={{ width: compact ? 5 : 6, height: compact ? 5 : 6, backgroundColor: view.tone }}
      />
      {view.word}
    </button>
  );
}

export function Sidebar() {
  const { view, setView, sidebarCollapsed, setSidebarCollapsed, newConversation, osintOpen, setOsintOpen, setSkillsOpen } = useApp();
  const auth = useAuth();

  const go = (id: NavId) => {
    if (id === 'research') {
      setOsintOpen(true);
      return;
    }
    setView(id);
  };
  const active = (id: NavId) => (id === 'research' ? osintOpen : view === id);

  const name = auth.user?.user_metadata?.display_name as string | undefined;
  const email = auth.user?.email;
  const displayName = name || email?.split('@')[0] || 'Your MetaIoid';
  const initial = displayName.slice(0, 1).toUpperCase();

  /* ── Collapsed rail ───────────────────────────────────────────────────── */
  if (sidebarCollapsed) {
    return (
      <aside
        className="hidden w-[64px] shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--bg-subtle)] py-4 text-[var(--fg)] md:flex"
        aria-label="Primary"
      >
        <button onClick={() => setView('chat')} aria-label="MetaIoid" title="Chat" className="my-1 rounded-[var(--radius-sm)] transition-opacity duration-small hover:opacity-80">
          <MetaIoidMark size={24} />
        </button>

        <button
          onClick={() => { newConversation(); setView('chat'); }}
          title="New chat"
          aria-label="New chat"
          className="mt-4 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-muted)] transition-colors duration-micro ease-out hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
        >
          <Plus size={18} strokeWidth={1.7} />
        </button>

        <nav className="mt-2 flex flex-col gap-0.5" aria-label="Collapsed navigation">
          {NAV.map((n) => (
            <RailButton key={n.id} label={n.label} icon={n.icon} on={active(n.id)} onClick={() => go(n.id)} />
          ))}
        </nav>

        <div className="mt-3 h-px w-6 bg-[var(--border-subtle)]" />

        <nav className="mt-3 flex flex-col gap-0.5" aria-label="Collapsed workspace">
          {WORKSPACE.map((n) => (
            <RailButton key={n.id} label={n.label} icon={n.icon} on={view === n.id} onClick={() => setView(n.id)} />
          ))}
          <RailButton label="Skills" icon={Sparkles} on={false} onClick={() => setSkillsOpen(true)} />
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1">
          <RailButton label="Settings" icon={Settings} on={view === 'settings'} onClick={() => setView('settings')} />
          <button
            title="Expand sidebar"
            aria-label="Expand sidebar"
            onClick={() => setSidebarCollapsed(false)}
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-muted)] transition-colors duration-micro ease-out hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
          >
            <ChevronRight size={17} strokeWidth={1.7} />
          </button>
        </div>
      </aside>
    );
  }

  /* ── Full sidebar ─────────────────────────────────────────────────────── */
  return (
    <aside
      className="hidden w-[248px] shrink-0 select-none flex-col border-r border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--fg)] md:flex"
      aria-label="Primary"
    >
      <div className="px-3.5 pb-2 pt-5">
        <div className="flex items-center justify-between">
          <button onClick={() => setView('chat')} className="min-w-0 rounded-[var(--radius-sm)] text-left transition-opacity duration-small hover:opacity-80" aria-label="MetaIoid home">
            <MetaIoidLockup variant="full" size="md" />
          </button>
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="icon-btn h-7 w-7"
            aria-label="Collapse sidebar"
            title="Collapse"
          >
            <ChevronLeft size={15} strokeWidth={1.7} />
          </button>
        </div>

        <button
          onClick={() => { newConversation(); setView('chat'); }}
          className="btn-primary mt-4 h-9 w-full text-ui"
        >
          <Plus size={15} strokeWidth={2} />
          New chat
        </button>
      </div>

      <nav className="space-y-0.5 px-3" aria-label="Main navigation">
        {NAV.map((n) => {
          const on = active(n.id);
          return (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'relative flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-ui font-medium',
                'transition-colors duration-micro ease-out',
                on ? 'bg-[var(--surface)] text-[var(--fg)] shadow-raised' : 'text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]',
              )}
            >
              <n.icon size={16} strokeWidth={on ? 2 : 1.7} />
              {n.label}
            </button>
          );
        })}
      </nav>

      <nav className="mt-5 space-y-0.5 px-3" aria-label="Workspace">
        <p className="px-3 pb-1.5 text-micro font-semibold text-[var(--fg-subtle)]">Workspace</p>
        {WORKSPACE.map((n) => {
          const on = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-ui',
                'transition-colors duration-micro ease-out',
                on ? 'bg-[var(--surface)] text-[var(--fg)] shadow-raised' : 'text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]',
              )}
            >
              <n.icon size={15} strokeWidth={on ? 2 : 1.7} />
              {n.label}
            </button>
          );
        })}
        <button
          onClick={() => setSkillsOpen(true)}
          className="flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-ui text-[var(--fg-muted)] transition-colors duration-micro ease-out hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
        >
          <Sparkles size={15} strokeWidth={1.7} />
          Skills
        </button>
      </nav>

      {/* Account row — the way out of the product, not a settings button. */}
      <div className="mt-auto px-3 pb-3 pt-4">
        <button
          onClick={() => setView('settings')}
          aria-current={view === 'settings' ? 'page' : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-[var(--radius-md)] p-2 text-left',
            'transition-colors duration-micro ease-out hover:bg-[var(--surface-hover)]',
            view === 'settings' && 'bg-[var(--surface)] shadow-raised',
          )}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-active)] text-small font-semibold text-[var(--fg-secondary)]">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui font-medium text-[var(--fg)]">{displayName}</span>
            <span className="block truncate text-micro font-normal tracking-normal text-[var(--fg-subtle)]">
              <ConnectionLine />
            </span>
          </span>
          <Settings size={15} strokeWidth={1.7} className="shrink-0 text-[var(--fg-subtle)]" />
        </button>
      </div>
    </aside>
  );
}

/**
 * The account row's second line. Honest about where data lives without turning
 * into a system monitor.
 */
function ConnectionLine() {
  const { connection } = useApp();
  const auth = useAuth();
  const where = !auth.configured
    ? 'On this device'
    : auth.status === 'signed-in'
      ? 'Synced'
      : 'On this device';

  const what =
    connection === 'online' ? 'Connected'
      : connection === 'checking' ? 'Connecting…'
        : connection === 'degraded' ? 'Unstable'
          : connection === 'mock' ? 'Demo mode'
            : 'Offline';

  return <>{where} · {what}</>;
}

function RailButton({
  label, icon: Icon, on, onClick,
}: {
  label: string;
  icon: typeof Plus;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] transition-colors duration-micro ease-out',
        on
          ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
          : 'text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]',
      )}
    >
      <Icon size={18} strokeWidth={on ? 2 : 1.7} />
    </button>
  );
}
