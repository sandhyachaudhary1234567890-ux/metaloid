import { motion } from 'framer-motion';
import { MessageSquare, History, Telescope, Settings, Mic } from 'lucide-react';
import { useApp } from '../lib/store';
import { cn } from '../lib/cn';

// Mobile navigation: four 48px targets and one unmistakable action.
// Voice is centred because it is the fastest way to talk to MetaIoid, and it is
// the only control here that is not a destination.

type Item = { id: 'chat' | 'history' | 'research' | 'settings'; label: string; icon: typeof MessageSquare };

const LEFT: Item[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'history', label: 'History', icon: History },
];
const RIGHT: Item[] = [
  { id: 'research', label: 'Research', icon: Telescope },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function BottomNav() {
  const { view, setView, setVoiceOpen, osintOpen, setOsintOpen } = useApp();

  const go = (id: Item['id']) => {
    if (id === 'research') { setOsintOpen(true); return; }
    setView(id);
  };
  const active = (id: Item['id']) => (id === 'research' ? osintOpen : view === id);

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-xl text-[var(--fg)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="grid grid-cols-5 px-1 pt-1 pb-1.5">
        {LEFT.map((n) => (
          <NavBtn key={n.id} {...n} active={active(n.id)} onClick={() => go(n.id)} />
        ))}
        <div className="flex justify-center">
          <button
            onClick={() => setVoiceOpen(true)}
            aria-label="Start voice mode"
            className="w-[52px] h-[52px] -mt-1 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-md active:scale-95 transition-transform"
          >
            <Mic size={21} />
          </button>
        </div>
        {RIGHT.map((n) => (
          <NavBtn key={n.id} {...n} active={active(n.id)} onClick={() => go(n.id)} />
        ))}
      </div>
    </nav>
  );
}

function NavBtn({ label, icon: Icon, active, onClick }: { label: string; icon: typeof MessageSquare; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 min-h-[54px] relative"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      {active && <motion.span layoutId="mnav-dot" className="absolute top-0 w-5 h-[2px] rounded-full bg-[var(--accent)]" />}
      <Icon size={20} strokeWidth={active ? 2 : 1.7} className={active ? 'text-[var(--accent)]' : 'text-[var(--fg-muted)]'} />
      <span className={cn('text-[10.5px] font-medium leading-none', active ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)]')}>{label}</span>
    </button>
  );
}
