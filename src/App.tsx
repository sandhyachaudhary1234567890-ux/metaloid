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
import { Toasts, ModalRoot } from './components/Overlays';
import { StartupSequence } from './components/StartupSequence';
import { ChatScreen } from './screens/ChatScreen';
import { LiveScreen } from './screens/LiveScreen';
import { MemoryScreen } from './screens/MemoryScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WifiOff } from 'lucide-react';

import { MetaIoidLockup, MetaIoidFavicon } from './components/brand';
import { AuthScreen } from './screens/AuthScreen';
import { useAuth } from './lib/auth';
import { SyncProvider } from './lib/sync';

function MobileTopBar() {
  return (
    <div className="md:hidden sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md">
      <div className="px-4 h-[52px] flex items-center gap-2.5">
        <button onClick={() => document.getElementById('main')?.scrollTo({ top: 0 })} aria-label="MetaIoid">
          <MetaIoidLockup variant="compact" size="sm" />
        </button>
        <span className="ml-auto"><ConnectionPill compact /></span>
      </div>
    </div>
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
  } = useApp();

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
  };

  if (gate) {
    if (auth.status === 'loading') {
      return (
        <div className="h-full flex items-center justify-center bg-[var(--bg)] text-[var(--fg-muted)]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
            <span className="text-[12.5px] tracking-wide">Restoring your session…</span>
          </div>
        </div>
      );
    }
    return <AuthScreen />;
  }

  return (
    <div className="h-full flex bg-[var(--bg)] text-[var(--fg)] overflow-hidden transition-colors duration-150">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <MobileTopBar />
        {view !== 'chat' && (
          <div className="hidden md:block">
            <Header title={meta[view].title} subtitle={meta[view].sub} />
          </div>
        )}
        {view !== 'chat' && (
          <div className="md:hidden px-4 pt-4">
            <h1 className="text-[20px] font-bold tracking-tight text-[var(--fg)]">{meta[view].title}</h1>
            <p className="text-[12.5px] text-[var(--fg-muted)]">{meta[view].sub}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="mx-4 sm:mx-8 mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
            <span className="flex items-center gap-2 text-[13px] font-medium text-amber-300"><WifiOff size={15} /> That request didn't go through.</span>
            <span className="text-[12.5px] text-[var(--fg-muted)] flex-1">
              {connection === 'online' ? 'The provider or network dropped it. Your message is still here.' : 'No gateway is connected, so answers come from the local demo.'}
            </span>
            <span className="flex gap-2">
              <button onClick={() => setStatus('idle')} className="btn-ghost h-8 px-3 text-[12.5px]">Dismiss</button>
              <button onClick={() => setView('settings')} className="btn-primary h-8 px-3 text-[12.5px]">Open settings</button>
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
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className={view === 'chat' ? 'h-full flex flex-col' : ''}
            >
              {view === 'chat' && <ChatScreen />}
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
