import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from './lib/store';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Sidebar, ConnectionPill } from './components/Sidebar';
import { BottomNav, MobileMoreSheet } from './components/BottomNav';
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
import { HomeScreen } from './screens/HomeScreen';
import { ChatScreen } from './screens/ChatScreen';
import { LiveScreen } from './screens/LiveScreen';
import { MemoryScreen } from './screens/MemoryScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { AuthScreen } from './components/AuthScreen';
import { Onboarding } from './components/Onboarding';
import { WifiOff, Menu } from 'lucide-react';

import { MetaIoidLockup, MetaIoidFavicon } from './components/brand';

function MobileTopBar() {
  const { setMobileSidebarOpen } = useApp();
  return (
    <div className="md:hidden sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md">
      <div className="px-3 h-14 flex items-center gap-2">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="icon-btn w-9 h-9 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)] shrink-0"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <MetaIoidLockup variant="compact" size="sm" />
        <span className="ml-auto"><ConnectionPill compact /></span>
      </div>
    </div>
  );
}

export default function App() {
  useKeyboardShortcuts();
  const {
    view, newConversation, setView, status, setStatus, voiceOpen,
    settings, connection, missionsOpen, setMissionsOpen, missionDraft,
    skillForgeOpen, setSkillForgeOpen,
    skillsOpen, setSkillsOpen,
    authUser, authReady, onboardingDone,
  } = useApp();

  const [moreOpen, setMoreOpen] = useState(false);
  const prevViewRef = useRef(view);
  const [intro, setIntro] = useState(
    () =>
      typeof window !== 'undefined' &&
      settings.showStartup &&
      !new URLSearchParams(window.location.search).has('no-intro')
  );

  useEffect(() => {
    if (prevViewRef.current !== view) {
      prevViewRef.current = view;
      MetaIoidFavicon.setDocumentTitle(view === 'home' ? undefined : view.charAt(0).toUpperCase() + view.slice(1));
    }
  }, [view]);

  const meta: Record<string, { title: string; sub: string }> = {
    projects: { title: 'Projects', sub: 'Persistent workspaces' },
    library: { title: 'Library', sub: 'Created files and artifacts' },
    research: { title: 'Research', sub: 'Cited investigations' },
    tasks: { title: 'Tasks', sub: 'Resumable agent work' },
    live: { title: 'Live', sub: 'Camera vision feed' },
    memory: { title: 'Memory Vault', sub: 'Personal durable context' },
    history: { title: 'History', sub: 'Past conversations' },
    settings: { title: 'Settings', sub: 'Configuration' },
  };

  // ---- identity gates (online gateway only; offline demo needs no account) ----
  if (!authReady || connection === 'checking') {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg)] text-[var(--fg-muted)] text-[13.5px]">
        Waking Metaloid…
      </div>
    );
  }
  if (view === 'auth') {
    return (
      <div className="h-full bg-[var(--bg)] text-[var(--fg)] overflow-hidden">
        <AuthScreen />
        <Toasts />
      </div>
    );
  }
  if (authUser && !onboardingDone) {
    return (
      <div className="h-full bg-[var(--bg)] text-[var(--fg)] overflow-hidden">
        <Onboarding />
        <Toasts />
      </div>
    );
  }

  return (
    <div className="h-full flex bg-[var(--bg)] text-[var(--fg)] overflow-hidden transition-colors duration-150">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {view !== 'chat' && <MobileTopBar />}
        {view !== 'home' && view !== 'chat' && (
          <div className="hidden md:block">
            <Header
              title={meta[view].title}
              subtitle={meta[view].sub}
            />
          </div>
        )}
        {view !== 'home' && view !== 'chat' && (
          <div className="md:hidden px-4 pt-4">
            <h1 className="text-[20px] font-bold tracking-tight text-[var(--fg)]">{meta[view].title}</h1>
            <p className="text-[12.5px] text-[var(--fg-muted)]">{meta[view].sub}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="mx-4 sm:mx-8 mt-4 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="flex items-center gap-2 text-[13.5px] font-semibold text-red-400"><WifiOff size={16} /> Connection issue encountered.</span>
            <span className="text-[12.5px] text-[var(--fg-muted)] flex-1">{connection === 'online' ? 'The request failed.' : 'Backend not connected — running local demo.'}</span>
            <span className="flex gap-2">
              <button onClick={() => setStatus('idle')} className="h-9 px-3.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[12.5px]">Dismiss</button>
              <button onClick={() => setView('settings')} className="h-9 px-3.5 rounded-lg bg-red-500 text-white text-[12.5px]">Check system</button>
            </span>
          </div>
        )}

        <main className="flex-1 min-h-0 overflow-y-auto" id="main">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className={view === 'chat' ? 'h-full flex flex-col' : ''}
            >
              {view === 'home' && <HomeScreen />}
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

        {view !== 'chat' && <BottomNav onMore={() => setMoreOpen(true)} />}
        <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      </div>

      <AnimatePresence>{voiceOpen && <VoiceMode key="voice" />}</AnimatePresence>
      <ToolsDrawer />
      <OsintPanel />
      <MissionsPanel open={missionsOpen} onClose={() => setMissionsOpen(false)} initialObjective={missionDraft} />
      <SkillForgePanel open={skillForgeOpen} onClose={() => setSkillForgeOpen(false)} />
      <SkillsPanel open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      <CommandPalette />
      <ModalRoot />
      <Toasts />

      {/* Type 1: 3D Reflection Metal Cube Startup Animation (4s) */}
      {intro && <StartupSequence onDone={() => setIntro(false)} />}

    </div>
  );
}
