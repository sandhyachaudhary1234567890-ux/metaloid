import { AnimatePresence, motion } from 'framer-motion';
import { X, Search, Calculator, CloudSun, Radar, Rocket, Eye, Mic } from 'lucide-react';
import { useApp } from '../lib/store';

// Tools, contextually — never a route and never a catalogue.
//
// Every row here does something the moment you tap it: research, missions,
// camera, voice, or a real prompt in this conversation. Rows that only said
// "coming soon" were removed rather than dressed up.

const TOOLS: { id: string; name: string; desc: string; icon: typeof Search; run?: string; live?: boolean; voice?: boolean; osint?: boolean; missions?: boolean }[] = [
  { id: 'osint', name: 'Research', desc: 'Public sources, every finding cited', icon: Radar, osint: true },
  { id: 'missions', name: 'A longer mission', desc: 'Plan, execute, verify — step by step', icon: Rocket, missions: true },
  { id: 'search', name: 'Web search', desc: 'Answer with live sources', icon: Search, run: 'Search the web for personal AI agents' },
  { id: 'calc', name: 'Calculator', desc: 'Instant math, works offline', icon: Calculator, run: 'Calculate 46 × 83' },
  { id: 'weather', name: 'Weather', desc: 'Current conditions', icon: CloudSun, run: 'Check the weather' },
  { id: 'vision', name: 'Camera', desc: 'Show MetaIoid what you see', icon: Eye, live: true },
  { id: 'voice', name: 'Voice', desc: 'Speak instead of typing', icon: Mic, voice: true },
];

export function ToolsDrawer() {
  const { toolsOpen, setToolsOpen, sendMessage, setView, setVoiceOpen, setOsintOpen, setOsintTarget, setMissionsOpen, setMissionDraft, connection } = useApp();
  const offline = connection !== 'online';

  const run = (t: (typeof TOOLS)[number]) => {
    setToolsOpen(false);
    if (t.osint) { setOsintTarget(''); setOsintOpen(true); return; }
    if (t.missions) { setMissionDraft(''); setMissionsOpen(true); return; }
    if (t.live) { setView('live'); return; }
    if (t.voice) { setVoiceOpen(true); return; }
    if (t.run) { setView('chat'); sendMessage(t.run); }
  };

  return (
    <AnimatePresence>
      {toolsOpen && (
        <>
          <motion.div className="fixed inset-0 z-[75] bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setToolsOpen(false)} />
          <motion.div
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed top-0 right-0 bottom-0 z-[76] w-full sm:w-[400px] border-l border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] p-5 overflow-y-auto"
            role="dialog" aria-label="Tools"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-start gap-3">
              <div>
                <h3 className="t-title">Tools</h3>
                <p className="text-small text-[var(--fg-muted)] mt-0.5">
                  What MetaIoid can use right now{offline ? ' — local demo' : ''}
                </p>
              </div>
              <button onClick={() => setToolsOpen(false)} className="icon-btn w-9 h-9 ml-auto" aria-label="Close tools"><X size={17} /></button>
            </div>
            <div className="mt-5 space-y-1.5">
              {TOOLS.map((t) => (
                <button
                  key={t.id} onClick={() => run(t)}
                  className="w-full flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-sunken)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] transition-colors p-3.5 text-left min-h-[64px]"
                >
                  <span className="w-10 h-10 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0">
                    <t.icon size={17} className="text-[var(--accent)]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-[var(--fg)] truncate">{t.name}</span>
                    <span className="block text-small text-[var(--fg-muted)] truncate">{t.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
