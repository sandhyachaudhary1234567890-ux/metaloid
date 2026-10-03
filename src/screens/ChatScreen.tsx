import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Square, MoreHorizontal, Pencil, Trash2, Plus, Telescope, Hammer, ChartNoAxesColumn, Sparkles } from 'lucide-react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { ChatWindow } from '../components/ChatWindow';
import { CommandBar, COMPOSER_MODES, type ComposerMode } from '../components/CommandBar';

// CHAT — the product.
//
// Three bands and nothing else: a small identity line, the conversation, the
// composer. When the conversation is empty the middle band holds one question
// and four ways to start; as soon as you speak, they are gone for good.

const STARTERS: { mode: ComposerMode; sample: string; icon: typeof Sparkles }[] = [
  { mode: COMPOSER_MODES.ask, sample: 'Explain something clearly', icon: Sparkles },
  { mode: COMPOSER_MODES.research, sample: 'Follow a topic to its sources', icon: Telescope },
  { mode: COMPOSER_MODES.build, sample: 'Turn an idea into something working', icon: Hammer },
  { mode: COMPOSER_MODES.analyze, sample: 'Break down what you are looking at', icon: ChartNoAxesColumn },
];

export function ChatScreen() {
  const {
    activeConv, isGenerating, stopGenerating, newConversation, openModal,
    renameConversation, setView, connection, status,
  } = useApp();
  const auth = useAuth();
  const messages = activeConv?.messages ?? [];

  const [moreOpen, setMoreOpen] = useState(false);
  const [mode, setMode] = useState<ComposerMode>(COMPOSER_MODES.ask);

  const firstName = useMemo(() => {
    const meta = (auth.user?.user_metadata ?? {}) as Record<string, unknown>;
    const raw = (meta.display_name as string | undefined) || auth.user?.email?.split('@')[0];
    if (!raw) return null;
    const first = raw.trim().split(/[\s._-]+/)[0];
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
  }, [auth.user]);

  const offline = connection !== 'online';
  const working = isGenerating || status === 'thinking' || status === 'executing';

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg)]">
      {/* identity line — quiet, 52px, never a dashboard */}
      <div className="mx-auto w-full max-w-[760px] px-4 sm:px-6 h-[52px] flex items-center gap-2 shrink-0">
        <h1 className="text-[13.5px] font-medium text-[var(--fg-muted)] truncate min-w-0">
          {activeConv?.title || 'New chat'}
        </h1>
        {working && (
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--accent)] shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
            {status === 'executing' ? 'Working' : 'Thinking'}
          </span>
        )}
        <span className="flex-1" />
        {isGenerating && (
          <button onClick={stopGenerating} className="btn-ghost h-8 px-3 text-[12.5px] shrink-0" aria-label="Stop">
            <Square size={11} fill="currentColor" /> Stop
          </button>
        )}
        <div className="relative shrink-0">
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className="icon-btn w-9 h-9"
            aria-label="Conversation options"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal size={18} />
          </button>
          <AnimatePresence>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 top-10 z-50 w-48 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-pop p-1.5"
                  role="menu"
                >
                  <MenuBtn icon={Plus} label="New chat" onClick={() => { newConversation(); setMoreOpen(false); }} />
                  <MenuBtn icon={Pencil} label="Rename" onClick={() => {
                    setMoreOpen(false);
                    if (activeConv) openModal('rename-chat', { name: activeConv.title, onRename: (t: string) => renameConversation(activeConv.id, t) });
                  }} />
                  <MenuBtn icon={Trash2} label="Delete" danger onClick={() => {
                    setMoreOpen(false);
                    if (activeConv) openModal('delete-chat', activeConv.id);
                  }} />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* conversation, or the single question that starts one */}
      {messages.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="min-h-full flex flex-col justify-center max-w-[680px] w-full mx-auto px-6 py-8">
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
              {firstName && <p className="text-[13px] text-[var(--fg-muted)] mb-1.5">{firstName}</p>}
              <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-tight text-[var(--fg)] leading-tight">
                What are we working on?
              </h2>
              <div className="mt-6 grid grid-cols-2 gap-2">
                {STARTERS.map(({ mode: m, sample, icon: Icon }) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m)}
                    className="group flex flex-col items-start gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] min-h-[84px]"
                  >
                    <Icon size={16} className="text-[var(--accent)]" />
                    <span className="text-[13.5px] font-medium text-[var(--fg)]">{m.label}</span>
                    <span className="text-[12px] text-[var(--fg-muted)] leading-snug">{sample}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      ) : (
        <ChatWindow messages={messages} />
      )}

      {/* composer, grounded near the bottom */}
      <div className="shrink-0 bg-[var(--bg)] pb-[74px] md:pb-3">
        <div className="mx-auto max-w-[760px] px-4 sm:px-6 pt-2">
          {offline && (
            <button
              onClick={() => setView('settings')}
              className="mb-2 text-[11.5px] text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
            >
              Local demo — answers come from a small offline model. <span className="underline">Connect AI</span>
            </button>
          )}
          <CommandBar mode={mode} onModeChange={setMode} onCamera={() => setView('live')} />
        </div>
      </div>
    </div>
  );
}

function MenuBtn({ icon: Icon, label, danger, onClick }: { icon: typeof Plus; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
        danger ? 'text-red-400 hover:bg-red-500/10' : 'text-[var(--fg)] hover:bg-[var(--surface-hover)]'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}
