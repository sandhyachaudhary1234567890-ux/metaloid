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
import { Toasts, ModalRoot } from './components/Overlays';
import { StartupSequence } from './components/StartupSequence';
import { BlockSwitchingTransition } from './components/animations/BlockSwitchingTransition';
import { DeviceMorphPreview } from './components/animations/DeviceMorphPreview';
import { HomeScreen } from './screens/HomeScreen';
import { ChatScreen } from './screens/ChatScreen';
import { LiveScreen } from './screens/LiveScreen';
import { MemoryScreen } from './screens/MemoryScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WifiOff, Smartphone } from 'lucide-react';

import { MetaIoidLockup, MetaIoidFavicon } from './components/brand';

function MobileTopBar({ onDeviceMorph }: { onDeviceMorph: () => void }) {
  return (
    <div className="md:hidden sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md">
      <div className="px-4 h-[56px] flex items-center gap-2.5">
        <MetaIoidLockup variant="compact" size="sm" />
        <button
          onClick={onDeviceMorph}
          className="icon-btn w-8 h-8 rounded-lg ml-auto hover:text-[var(--accent)]"
          title="Showcase 360° Morphing Device (4s)"
          aria-label="360 Device Showcase"
        >
          <Smartphone size={15} />
        </button>
        <span><ConnectionPill compact /></span>
      </div>
    </div>
  );
}

export default function App() {
  useKeyboardShortcuts();
  const {
    view, newConversation, setView, status, setStatus, voiceOpen,
    settings, connection, missionsOpen, setMissionsOpen, missionDraft,
    deviceMorphOpen, setDeviceMorphOpen,
    skillForgeOpen, setSkillForgeOpen,
  } = useApp();

  const [moreOpen, setMoreOpen] = useState(false);
  const [switchingView, setSwitchingView] = useState(false);
  const prevViewRef = useRef(view);
  const [intro, setIntro] = useState(
    () =>
      typeof window !== 'undefined' &&
      settings.showStartup &&
      !new URLSearchParams(window.location.search).has('no-intro')
  );

  // Block Switching Transition on page/view changes (min 1.25s, max 5s)
  useEffect(() => {
    if (prevViewRef.current !== view) {
      prevViewRef.current = view;
      setSwitchingView(true);
      MetaIoidFavicon.setDocumentTitle(view === 'home' ? undefined : view.charAt(0).toUpperCase() + view.slice(1));
    }
  }, [view]);

  const meta: Record<string, { title: string; sub: string }> = {
    live: { title: 'Live', sub: 'Camera vision feed' },
    memory: { title: 'Memory Vault', sub: 'Personal durable context' },
    history: { title: 'History', sub: 'Past conversations' },
    settings: { title: 'Settings', sub: 'Configuration' },
  };

  return (
    <div className="h-full flex bg-[var(--bg)] text-[var(--fg)] overflow-hidden transition-colors duration-150">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <MobileTopBar onDeviceMorph={() => setDeviceMorphOpen(true)} />
        {view !== 'home' && view !== 'chat' && (
          <div className="hidden md:block">
            <Header
              title={meta[view].title}
              subtitle={meta[view].sub}
              onDeviceMorph={() => setDeviceMorphOpen(true)}
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
              {view === 'live' && <LiveScreen />}
              {view === 'memory' && <MemoryScreen />}
              {view === 'history' && <HistoryScreen />}
              {view === 'settings' && <SettingsScreen />}
            </motion.div>
          </AnimatePresence>
        </main>

        <BottomNav onMore={() => setMoreOpen(true)} />
        <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
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

      {/* Type 3: 360 Rotating Morphing Device Animation (4s on trigger) */}
      <DeviceMorphPreview
        isOpen={deviceMorphOpen}
        onClose={() => setDeviceMorphOpen(false)}
        featureName="360° Responsive Morph Showcase"
      />

      {/* Block Switching Animation: Page transition & process loader (min 1.25s, max 5s) */}
      <BlockSwitchingTransition
        active={switchingView}
        minDuration={1250}
        maxDuration={5000}
        label={view.toUpperCase()}
        hint="Switching workspace…"
        onComplete={() => setSwitchingView(false)}
      />
    </div>
  );
}
