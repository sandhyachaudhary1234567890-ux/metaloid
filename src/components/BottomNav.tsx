import { AnimatePresence, motion } from 'framer-motion';
import { Home, MessageSquare, Radio, Brain, Mic, History, Settings, Plus, X } from 'lucide-react';
import { useApp } from '../lib/store';
import { cn } from '../lib/cn';

// Mobile navigation with 48px+ touch targets, semantic theme tokens,
// and clean integrated voice activation FAB.

export function BottomNav({ onMore }: { onMore: () => void }) {
  const { view, setView, setVoiceOpen } = useApp();
  const items = [
    { id: 'home' as const, label: 'Home', icon: Home },
    { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
    { id: 'live' as const, label: 'Live', icon: Radio },
    { id: 'memory' as const, label: 'Memory', icon: Brain },
  ];
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-xl text-[var(--fg)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Mobile navigation"
    >
      <div className="relative grid grid-cols-5 px-2 pt-1 pb-1.5">
        {items.slice(0, 2).map((n) => (
          <NavBtn key={n.id} active={view === n.id} label={n.label} Icon={n.icon} onClick={() => { setView(n.id); }} />
        ))}
        <div className="flex justify-center -mt-6">
          <button
            onClick={() => setVoiceOpen(true)}
            aria-label="Start voice mode"
            className="w-[52px] h-[52px] rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-md active:scale-95 transition-all border-4 border-[var(--bg)]"
          >
            <Mic size={20} />
          </button>
        </div>
        {items.slice(2).map((n) => (
          <NavBtn key={n.id} active={view === n.id} label={n.label} Icon={n.icon} onClick={() => setView(n.id)} />
        ))}
      </div>
      <button onClick={onMore} className="absolute right-2 top-1 icon-btn w-10 h-10" aria-label="More options">
        <Plus size={18} />
      </button>
    </nav>
  );
}

function NavBtn({ active, label, Icon, onClick }: { active: boolean; label: string; Icon: typeof Home; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 py-1.5 min-h-[48px] relative" aria-label={label} aria-current={active ? 'page' : undefined}>
      {active && <motion.span layoutId="mnav-dot" className="absolute top-0 w-6 h-[2.5px] rounded-full bg-[var(--accent)]" />}
      <Icon size={20} strokeWidth={active ? 2 : 1.7} className={active ? 'text-[var(--accent)]' : 'text-[var(--fg-muted)]'} />
      <span className={cn('text-[10.5px] font-medium', active ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)]')}>{label}</span>
    </button>
  );
}

export function MobileMoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setView, newConversation, setVoiceOpen } = useApp();
  const go = (v: 'history' | 'settings' | 'chat', fresh = false) => {
    if (fresh) newConversation();
    setView(v);
    onClose();
  };
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-50 bg-black/60 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-[var(--border)] bg-[var(--surface-elevated)] p-5 pb-8 md:hidden text-[var(--fg)]"
          >
            <div className="w-10 h-1 bg-[var(--border-strong)] rounded-full mx-auto mb-4" />
            <div className="space-y-1">
              <button onClick={() => go('chat', true)} className="w-full flex items-center gap-3 px-4 h-12 rounded-xl text-[14px] font-medium hover:bg-[var(--surface-hover)]">
                <Plus size={18} /> New conversation
              </button>
              <button onClick={() => go('history')} className="w-full flex items-center gap-3 px-4 h-12 rounded-xl text-[14px] font-medium hover:bg-[var(--surface-hover)]">
                <History size={18} /> History & past turns
              </button>
              <button onClick={() => go('settings')} className="w-full flex items-center gap-3 px-4 h-12 rounded-xl text-[14px] font-medium hover:bg-[var(--surface-hover)]">
                <Settings size={18} /> Settings
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
