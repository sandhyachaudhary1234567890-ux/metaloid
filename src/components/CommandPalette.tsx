import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, MessageSquare, Mic, Radio, Brain, History, Settings, Trash2, Plus, Globe, Command, Sparkles, Radar, Rocket, Palette, Smartphone, Flame } from 'lucide-react';
import { useApp } from '../lib/store';
import type { ThemeId } from '../lib/types';
import { cn } from '../lib/cn';
import { GlobalStopController } from '../lib/ready/globalStop';
import { SituationAwareness } from '../lib/ready/situationAwareness';
import { MetaIoidLockup } from './brand';

export function CommandPalette() {
  const {
    paletteOpen, setPaletteOpen, newConversation, setView, setVoiceOpen,
    setToolsOpen, setOsintOpen, setOsintTarget, setMissionsOpen, setMissionDraft,
    deviceMorphOpen, setDeviceMorphOpen, setSkillForgeOpen,
    toast, openModal, activeConv, setLanguage, language, updateSettings,
  } = useApp();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const actions = useMemo(() => [
    { id: 'stop-all', label: 'Stop all: Emergency halt', hint: 'Halt speech, pause background tasks, keep completed work', icon: Flame, run: () => {
        const res = GlobalStopController.stopAll();
        toast({ title: 'MetaIoid Stopped', desc: res.message });
      }
    },
    { id: 'situation', label: 'What is MetaIoid doing?', hint: 'Live situational brief of active and background tasks', icon: Sparkles, run: () => {
        const sit = SituationAwareness.getStatusBrief();
        toast({ title: sit.headline, desc: sit.speechResponse });
      }
    },
    { id: 'new', label: 'New chat', hint: 'Start fresh conversation', icon: Plus, run: () => { newConversation(); setView('chat'); } },
    { id: 'voice', label: 'Start voice mode', hint: 'Real-time spoken dialogue', icon: Mic, run: () => setVoiceOpen(true) },
    { id: 'live', label: 'Start live camera mode', hint: 'Talk while showing camera', icon: Radio, run: () => setView('live') },
    { id: 'memory', label: 'Open Memory Vault', hint: 'Local personal context facts', icon: Brain, run: () => setView('memory') },
    { id: 'history', label: 'Open History', hint: 'Past conversations & turns', icon: History, run: () => setView('history') },
    { id: 'agents', label: 'Agents & tools drawer', hint: 'Contextual tool capabilities', icon: Sparkles, run: () => setToolsOpen(true) },
    { id: 'osint', label: 'OSINT investigation', hint: 'Domains & repositories research', icon: Radar, run: () => { setOsintTarget(''); setOsintOpen(true); } },
    { id: 'missions', label: 'Mission Control', hint: 'Multi-step autonomous workflows', icon: Rocket, run: () => { setMissionDraft(''); setMissionsOpen(true); } },
    { id: 'theme-obsidian', label: 'Switch Theme: Obsidian', hint: 'Deep neutral charcoal & obsidian', icon: Palette, run: () => { updateSettings({ theme: 'obsidian' as ThemeId }); toast({ title: 'Theme: Obsidian' }); } },
    { id: 'theme-graphite', label: 'Switch Theme: Graphite', hint: 'Cool slate and technical graphite', icon: Palette, run: () => { updateSettings({ theme: 'graphite' as ThemeId }); toast({ title: 'Theme: Graphite' }); } },
    { id: 'theme-warm-paper', label: 'Switch Theme: Warm Paper', hint: 'Editorial warm ivory (Light)', icon: Palette, run: () => { updateSettings({ theme: 'warm-paper' as ThemeId }); toast({ title: 'Theme: Warm Paper' }); } },
    { id: 'theme-nordic', label: 'Switch Theme: Nordic', hint: 'Crisp minimalist slate & white (Light)', icon: Palette, run: () => { updateSettings({ theme: 'nordic' as ThemeId }); toast({ title: 'Theme: Nordic' }); } },
    { id: 'theme-oled', label: 'Switch Theme: OLED Pure Black', hint: 'Pitch black #000000 contrast', icon: Palette, run: () => { updateSettings({ theme: 'oled' as ThemeId }); toast({ title: 'Theme: OLED' }); } },
    { id: 'theme-system', label: 'Switch Theme: System Auto', hint: 'Follows operating system dark/light', icon: Palette, run: () => { updateSettings({ theme: 'system' as ThemeId }); toast({ title: 'Theme: System' }); } },
    { id: 'developer-forge', label: 'Developer: Skill Forge & Continuous Engine', hint: 'Inspect registry, benchmarks, canary tests & rollback', icon: Flame, run: () => setSkillForgeOpen(true) },
    { id: 'settings', label: 'Open Settings', hint: 'Application configuration', icon: Settings, run: () => setView('settings') },
    { id: 'lang', label: `Toggle language (currently ${language})`, hint: 'Auto &middot; Hindi &middot; English', icon: Globe, run: () => { setLanguage(language === 'hi' ? 'en' : 'hi'); toast({ title: 'Language toggled' }); } },
    { id: 'device-morph', label: 'Showcase 360° Morphing Device (4s)', hint: 'Responsive 3D device form rotation', icon: Smartphone, run: () => setDeviceMorphOpen(true) },
    { id: 'clear', label: 'Clear current conversation', hint: activeConv ? activeConv.title : 'No active chat', icon: Trash2, run: () => { if (activeConv) openModal('delete-chat', activeConv.id); } },
  ], [newConversation, setView, setVoiceOpen, setToolsOpen, setOsintOpen, setOsintTarget, setMissionsOpen, setMissionDraft, setDeviceMorphOpen, language, setLanguage, updateSettings, toast, activeConv, openModal]);

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()) || a.hint.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (paletteOpen) {
      setQ(''); setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [paletteOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newConversation(); setView('chat'); setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newConversation, setView, setPaletteOpen]);

  if (!paletteOpen) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center pt-[10vh] sm:pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPaletteOpen(false)} />
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-[560px] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg)] shadow-pop overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 border-b border-[var(--border)]">
          <Search size={16} className="text-[var(--fg-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter') { filtered[idx]?.run(); setPaletteOpen(false); }
            }}
            placeholder="Type a command or search…"
            className="flex-1 h-13 bg-transparent outline-none text-[14.5px] text-[var(--fg)] placeholder:text-[var(--fg-subtle)]"
            aria-label="Search commands"
          />
          <kbd className="hidden sm:flex items-center gap-1 font-mono text-[10.5px] text-[var(--fg-muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
            <Command size={10} />K
          </kbd>
        </div>
        <div className="p-2 max-h-[340px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--fg-muted)]">No commands found.</div>
          )}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              onMouseEnter={() => setIdx(i)}
              onClick={() => { a.run(); setPaletteOpen(false); }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors',
                i === idx ? 'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--fg)]' : 'border border-transparent text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
              )}
            >
              <span className="w-8 h-8 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center shrink-0">
                <a.icon size={15} className={i === idx ? 'text-[var(--accent)]' : 'text-[var(--fg-muted)]'} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-medium text-[var(--fg)] truncate">{a.label}</span>
                <span className="block text-[11.5px] text-[var(--fg-muted)] truncate">{a.hint}</span>
              </span>
              {i === idx && <span className="text-[11px] text-[var(--fg-muted)] font-mono">↵</span>}
            </button>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-[var(--border)] flex items-center justify-between text-[11.5px] text-[var(--fg-muted)] bg-[var(--surface)]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><MessageSquare size={11} /> New chat ⌘N</span>
            <span>↑↓ navigate</span>
            <span>↵ run</span>
            <span>esc close</span>
          </div>
          <MetaIoidLockup variant="compact" size="sm" />
        </div>
      </motion.div>
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center max-w-[420px] mx-auto">
      <h3 className="text-[15px] font-semibold text-[var(--fg)]">{title}</h3>
      <p className="text-[13px] text-[var(--fg-muted)] mt-1">{desc}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
