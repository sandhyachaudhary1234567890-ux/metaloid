import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useApp } from './lib/store';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Sidebar, ConnectionPill } from './components/Sidebar';
import { BottomNav } from './components/BottomNav';
import { Header } from './components/Header';
import { VoiceMode } from './components/VoiceMode';
import { CommandPalette } from './components/CommandPalette';
import { ToolsDrawer } from './components/ToolsDrawer';
import { OsintPanel } from './components/OsintPanel';
import { MissionsPanel } from './components/MissionsPanel';
import { SkillForgePanel } from './components/developer/SkillForgePanel';
import { SkillsPanel } from './components/SkillsPanel';
import { Toasts, ModalRoot } from './components/Overlays';
import { StartupSequence } from './components/StartupSequence';
import { ChatScreen } from './screens/ChatScreen';
import { LiveScreen } from './screens/LiveScreen';
import { MemoryScreen } from './screens/MemoryScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { WifiOff, X, Archive, Library, Telescope, CheckCircle2 } from 'lucide-react';

import { MetaIoidLockup, MetaIoidFavicon } from './components/brand';
import { AuthScreen } from './screens/AuthScreen';
import { useAuth } from './lib/auth';
import { SyncProvider } from './lib/sync';

function MobileTopBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  return (
    <div className="md:hidden sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] backdrop-blur-md">
      <div className="px-4 h-[52px] flex items-center gap-2.5">
        <button onClick={() => onMore()} aria-label={moreOpen ? 'Close menu' : 'More'} aria-expanded={moreOpen}
          className="w-9 h-9 -ml-1 rounded-lg flex items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)]">
          {moreOpen ? <X size={18} /> : (
            <span className="flex flex-col gap-[3px]" aria-hidden>
              <span className="block w-[15px] h-[1.5px] bg-current rounded" />
              <span className="block w-[15px] h-[1.5px] bg-current rounded" />
              <span className="block w-[15px] h-[1.5px] bg-current rounded" />
            </span>
          )}
        </button>
        <button onClick={() => document.getElementById('main')?.scrollTo({ top: 0 })} aria-label="MetaIoid">
          <MetaIoidLockup variant="compact" size="sm" />
        </button>
        <span className="ml-auto"><ConnectionPill compact /></span>
      </div>
    </div>
  );
}

const WORKSPACE_ITEMS = [
  { id: 'projects' as const, label: 'Projects', hint: 'Workspaces and their instructions', icon: Archive },
  { id: 'library' as const, label: 'Library', hint: 'Files MetaIoid has created', icon: Library },
  { id: 'research' as const, label: 'Research', hint: 'Cited investigations', icon: Telescope },
  { id: 'tasks' as const, label: 'Tasks', hint: 'Long-running agent work', icon: CheckCircle2 },
];

/**
 * The one screen in the product that is allowed to look like it is waiting.
 * It offers a way out after a few seconds so a slow auth service can never
 * make the app feel broken.
 */
function RestoringSession({ onSkip }: { onSkip: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-[var(--bg)] text-[var(--fg-muted)]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
        <span className="text-small tracking-wide">Restoring your session…</span>
      </div>
      {slow && (
        <button onClick={onSkip} className="btn-ghost h-9 px-4 text-ui">
          Continue without signing in
        </button>
      )}
    </div>
  );
}

/** Secondary destinations on phones: workspaces plus the skills panel. */
function MobileMoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setView, setSkillsOpen } = useApp();
  const go = (id: (typeof WORKSPACE_ITEMS)[number]['id']) => { setView(id); onClose(); };
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} aria-label="Close menu"
            className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          />
          <motion.div
            key="sheet" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="md:hidden fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-[var(--border)] bg-[var(--surface)] p-4 pb-8"
            style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
          >
            <p className="text-micro font-semibold uppercase tracking-wider text-[var(--fg-faint)]">Workspace</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {WORKSPACE_ITEMS.map((w) => (
                <button key={w.id} onClick={() => go(w.id)}
                  className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-left">
                  <w.icon size={16} className="mt-0.5 text-[var(--accent)]" />
                  <span className="min-w-0">
                    <span className="block text-ui font-medium text-[var(--fg)]">{w.label}</span>
                    <span className="block text-micro text-[var(--fg-muted)]">{w.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => { setSkillsOpen(true); onClose(); }}
              className="mt-3 w-full h-11 rounded-xl border border-[var(--border)] text-ui font-medium text-[var(--fg)]"
            >
              Skills
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function AppShell() {
  const auth = useAuth();

  // Gate on the session only when an auth service is actually configured:
  // an unconfigured build must remain fully usable offline.
  const gate = auth.configured && auth.status !== 'signed-in';
  useKeyboardShortcuts(gate);
  const {
    view, newConversation, setView, status, setStatus, voiceOpen,
    settings, connection, missionsOpen, setMissionsOpen, missionDraft,
    skillForgeOpen, setSkillForgeOpen,
    skillsOpen, setSkillsOpen,
  } = useApp();

  const [moreOpen, setMoreOpen] = useState(false);
  // A way past a stalled session restore. The bootstrap always resolves now,
  // but a slow /api/config should never be able to trap anyone on a spinner.
  const [authBypass, setAuthBypass] = useState(false);

  const prevViewRef = useRef(view);
  const [intro, setIntro] = useState(
    () =>
      typeof window !== 'undefined' &&
      settings.showStartup &&
      !new URLSearchParams(window.location.search).has('no-intro')
  );

  // Keep the document title honest without holding the UI back: navigation is
  // instant, and the only motion is a 160ms cross-fade inside <main>.
  useEffect(() => {
    if (prevViewRef.current !== view) {
      prevViewRef.current = view;
      MetaIoidFavicon.setDocumentTitle(view === 'chat' ? undefined : view.charAt(0).toUpperCase() + view.slice(1));
    }
  }, [view]);

  const meta: Record<string, { title: string; sub: string }> = {
    live: { title: 'Live', sub: 'Camera vision feed' },
    memory: { title: 'Memory Vault', sub: 'Personal durable context' },
    history: { title: 'History', sub: 'Past conversations' },
    settings: { title: 'Settings', sub: 'Configuration' },
    projects: { title: 'Projects', sub: 'Persistent workspaces' },
    library: { title: 'Library', sub: 'Files MetaIoid created' },
    research: { title: 'Research', sub: 'Cited investigations' },
    tasks: { title: 'Tasks', sub: 'Resumable agent work' },
  };
  const head = meta[view] || { title: 'MetaIoid', sub: '' };

  if (gate && !authBypass) {
    if (auth.status === 'loading') {
      return <RestoringSession onSkip={() => setAuthBypass(true)} />;
    }
    return <AuthScreen />;
  }

  return (
    <div className="h-full flex bg-[var(--bg)] text-[var(--fg)] overflow-hidden transition-colors duration-150">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <MobileTopBar onMore={() => setMoreOpen(true)} moreOpen={moreOpen} />
        {view !== 'chat' && (
          <div className="hidden md:block">
            <Header title={head.title} subtitle={head.sub} />
          </div>
        )}
        {view !== 'chat' && (
          <div className="md:hidden px-4 pt-4">
            <h1 className="t-heading text-[var(--fg)]">{head.title}</h1>
            <p className="mt-0.5 text-small text-[var(--fg-muted)]">{head.sub}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="mx-4 sm:mx-8 mt-3 rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
            <span className="flex items-center gap-2 text-ui font-medium text-warning"><WifiOff size={15} /> That request didn't go through.</span>
            <span className="text-small text-[var(--fg-muted)] flex-1">
              {connection === 'online' ? 'The provider or network dropped it. Your message is still here.' : 'No gateway is connected, so answers come from the local demo.'}
            </span>
            <span className="flex gap-2">
              <button onClick={() => setStatus('idle')} className="btn-ghost h-8 px-3 text-small">Dismiss</button>
              <button onClick={() => setView('settings')} className="btn-primary h-8 px-3 text-small">Open settings</button>
            </span>
          </div>
        )}

        <main className="flex-1 min-h-0 overflow-y-auto" id="main">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={view === 'chat' ? 'h-full flex flex-col' : ''}
            >
              {view === 'chat' && <ChatScreen />}
              {view === 'projects' && <WorkspaceScreen kind="projects" />}
              {view === 'library' && <WorkspaceScreen kind="library" />}
              {view === 'research' && <WorkspaceScreen kind="research" />}
              {view === 'tasks' && <WorkspaceScreen kind="tasks" />}
              {view === 'live' && <LiveScreen />}
              {view === 'memory' && <MemoryScreen />}
              {view === 'history' && <HistoryScreen />}
              {view === 'settings' && <SettingsScreen />}
            </motion.div>
          </AnimatePresence>
        </main>

        <BottomNav />
      </div>

      <AnimatePresence>{voiceOpen && <VoiceMode key="voice" />}</AnimatePresence>
      <ToolsDrawer />
      <OsintPanel />
      <MissionsPanel open={missionsOpen} onClose={() => setMissionsOpen(false)} initialObjective={missionDraft} />
      <SkillForgePanel open={skillForgeOpen} onClose={() => setSkillForgeOpen(false)} />
      <SkillsPanel open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <CommandPalette />
      <ModalRoot />
      <Toasts />

      {/* Type 1: 3D Reflection Metal Cube Startup Animation (4s) */}
      {intro && <StartupSequence onDone={() => setIntro(false)} />}

    </div>
  );
}

/**
 * The sync loop runs above the shell so the shell (and Settings) can read its
 * state. It is a no-op when signed out — the sandbox demo never needs an
 * account, and an unconfigured build never sees a login it cannot pass.
 */
export default function App() {
  return (
    // reducedMotion="user" makes every framer-motion animation honour the OS
    // setting, matching the CSS rule in index.css.
    <MotionConfig reducedMotion="user">
      <SyncProvider>
        <AppShell />
      </SyncProvider>
    </MotionConfig>
  );
}
