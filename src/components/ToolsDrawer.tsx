import { AnimatePresence, motion } from 'framer-motion';
import { X, Search, Calculator, StickyNote, CloudSun, Globe2, Eye, Mic, Calendar, FolderOpen, Radar, Rocket } from 'lucide-react';
import { useApp } from '../lib/store';
import { cn } from '../lib/cn';

// Agents & tools as a CONTEXTUAL drawer (§20, §24) — never a route.
// Every entry does something: demo tools run in chat, providers explain.

const TOOLS: { id: string; name: string; desc: string; icon: typeof Search; run: string | null; live?: boolean; voice?: boolean; osint?: boolean; missions?: boolean }[] = [
  { id: 'osint', name: 'OSINT investigation', desc: 'Domains, usernames, repos — cited', icon: Radar, run: null, osint: true },
  { id: 'missions', name: 'Mission Control', desc: 'Multi-step agent missions', icon: Rocket, run: null, missions: true },
  { id: 'search', name: 'Web Search', desc: 'Answer with live sources', icon: Search, run: 'Search the web for personal AI agents' },
  { id: 'calc', name: 'Calculator', desc: 'Instant math, works in demo', icon: Calculator, run: 'Calculate 46 × 83' },
  { id: 'weather', name: 'Weather', desc: 'Current conditions snapshot', icon: CloudSun, run: 'Check the weather' },
  { id: 'notes', name: 'Notes', desc: 'Capture to memory', icon: StickyNote, run: null as string | null },
  { id: 'browser', name: 'Browser', desc: 'Open and summarize pages', icon: Globe2, run: null },
  { id: 'calendar', name: 'Calendar', desc: 'Events and reminders', icon: Calendar, run: null },
  { id: 'files', name: 'Files', desc: 'Local context', icon: FolderOpen, run: null },
  { id: 'vision', name: 'Vision', desc: 'Camera understanding', icon: Eye, run: null, live: true },
  { id: 'voice', name: 'Voice', desc: 'Speak instead of typing', icon: Mic, run: null, voice: true },
];

export function ToolsDrawer() {
  const { toolsOpen, setToolsOpen, sendMessage, setView, setVoiceOpen, setOsintOpen, setOsintTarget, setMissionsOpen, setMissionDraft, toast, connection } = useApp();
  const offline = connection !== 'online';

  const run = (t: (typeof TOOLS)[number]) => {
    setToolsOpen(false);
    if (t.osint) { setOsintTarget(''); setOsintOpen(true); return; }
    if (t.missions) { setMissionDraft(''); setMissionsOpen(true); return; }
    if (t.live) { setView('live'); return; }
    if (t.voice) { setVoiceOpen(true); return; }
    if (t.run) { setView('chat'); sendMessage(t.run); return; }
    toast({ title: `${t.name} connects with the backend`, desc: 'This prototype keeps it as a placeholder' });
  };

  return (
    <AnimatePresence>
      {toolsOpen && (
        <>
          <motion.div className="fixed inset-0 z-[75] bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setToolsOpen(false)} />
          <motion.div
            initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-[76] w-full sm:w-[400px] border-l border-white/10 bg-ink-850 p-6 overflow-y-auto"
            role="dialog" aria-label="Agents and tools"
          >
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-[17px] font-bold tracking-tight">Agents & tools</h3>
                <p className="text-[12.5px] text-zinc-500 mt-0.5">
                  Contextual capabilities · {offline ? 'demo mode' : 'connected'}
                </p>
              </div>
              <button onClick={() => setToolsOpen(false)} className="icon-btn w-9 h-9 ml-auto" aria-label="Close tools"><X size={17} /></button>
            </div>
            <div className="mt-5 space-y-2">
              {TOOLS.map((t) => (
                <button
                  key={t.id} onClick={() => run(t)}
                  className="w-full flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.13] transition-all p-3.5 text-left"
                >
                  <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center shrink-0">
                    <t.icon size={18} className="text-zinc-200" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold">{t.name}</span>
                    <span className="block text-[12.5px] text-zinc-500 truncate">{t.desc}</span>
                  </span>
                  <span className={cn('text-[10.5px] font-bold tracking-widest rounded-full px-2 py-1 border shrink-0',
                    t.run || t.live || t.voice || t.osint || t.missions
                      ? 'text-cyan-200 border-cyan-200/25 bg-cyan-300/[0.06]'
                      : 'text-zinc-500 border-white/10')}>
                    {t.run || t.live || t.voice || t.osint || t.missions ? 'TRY' : 'SOON'}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-5 text-[12px] leading-relaxed text-zinc-600">
              Tools appear inline in conversation when the agent uses them. Provider connections live in Settings → System.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
