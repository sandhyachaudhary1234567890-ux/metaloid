import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Square, MoreHorizontal, Pencil, Trash2, Plus, Telescope, Hammer, ChartNoAxesColumn, Sparkles } from 'lucide-react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { currentOwner, runVaultSweepOnce } from '../lib/historyVault';
import { ChatWindow } from '../components/ChatWindow';
import { SetupChecklist } from '../components/SetupChecklist';
import { CommandBar, COMPOSER_MODES, type ComposerMode } from '../components/CommandBar';
import { Artwork } from '../components/ui/Artwork';
import { ActiveMission, HomeGreeting, HomeSignals, PresenceLine } from '../components/ui/Home';
import { LiveActivity } from '../components/LiveActivity';
import { MetaIoidLockup } from '../components/brand';
import { cn } from '../lib/cn';
import { duration, ease } from '../design/motion';

// CHAT — the product.
//
// Three bands and nothing else: a quiet identity line, the conversation, the
// composer. When the conversation is empty the middle band becomes the welcome
// composition — identity, one question, four ways in.

const STARTERS: { mode: ComposerMode; sample: string; icon: typeof Sparkles }[] = [
  { mode: COMPOSER_MODES.ask, sample: 'Explain something clearly', icon: Sparkles },
  { mode: COMPOSER_MODES.research, sample: 'Follow a topic to its sources', icon: Telescope },
  { mode: COMPOSER_MODES.build, sample: 'Turn an idea into something working', icon: Hammer },
  { mode: COMPOSER_MODES.analyze, sample: 'Break down what you are looking at', icon: ChartNoAxesColumn },
];

/**
 * The welcome composition — what a user sees before they type.
 *
 * Order matters, and it is the product's opening sentence: who is here
 * (presence), where you are (greeting), what is already open (mission, pulse),
 * and only then the ways in. Nothing else. It is deliberately centred with a
 * lot of air around it, because the first screen is where the product decides
 * whether it feels expensive or feels like a dashboard.
 */
function Welcome({ firstName, onPick }: { firstName: string | null; onPick: (m: ComposerMode) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: duration.large, ease: ease.out }}
        className="flex w-full max-w-[var(--welcome-width)] flex-col items-center text-center"
      >
        {/* Presence — the first thing on the screen, and the quietest. */}
        <PresenceLine />

        <MetaIoidLockup variant="full" size="sm" className="mt-6 opacity-90" />

        {/* The one visual moment on this screen. */}
        <Artwork
          name="atmosphere"
          size={132}
          radius="xl"
          priority
          className="mt-7 mb-7 opacity-95"
        />

        <HomeGreeting name={firstName} />

        <p className="mt-3 max-w-[42ch] text-body text-[var(--fg-muted)] text-pretty">
          Ask anything, or pick a place to start.
        </p>

        {/* What is already open. Renders nothing when nothing is. */}
        <ActiveMission className="mt-7" />
        <HomeSignals className="mt-2.5" />

        {/* Capability entrances — a quiet row, not a wall of cards. */}
        <div className="mt-9 grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4">
          {STARTERS.map(({ mode: m, sample, icon: Icon }, i) => (
            <motion.button
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.medium, ease: ease.out, delay: 0.18 + i * 0.045 }}
              onClick={() => onPick(m)}
              className={cn(
                'group flex flex-col items-center gap-2 rounded-[var(--radius-lg)]',
                'border border-transparent px-3 py-4 text-center',
                'transition-colors duration-small ease-out',
                'hover:border-[var(--border)] hover:bg-[var(--surface)]',
                'focus-visible:border-[var(--border)] focus-visible:bg-[var(--surface)]',
              )}
            >
              <Icon
                size={17}
                strokeWidth={1.6}
                className="text-[var(--fg-muted)] transition-colors duration-small ease-out group-hover:text-[var(--accent)]"
              />
              <span className="text-ui font-medium text-[var(--fg)]">{m.label}</span>
              <span className="text-small leading-snug text-[var(--fg-muted)] text-pretty">{sample}</span>
            </motion.button>
          ))}
        </div>

        {/* Process indicator: only renders while the app is not live. */}
        <SetupChecklist />

        {/* Real task activity, emitted by the agent runtime. Hidden until then. */}
        <div className="mt-6 w-full">
          <LiveActivity />
        </div>
      </motion.div>
    </div>
  );
}

export function ChatScreen() {
  const {
    activeConv, isGenerating, stopGenerating, newConversation, openModal,
    renameConversation, setView, connection, status, statusText,
    conversations, deleteConversation, settings, toast,
  } = useApp();
  const auth = useAuth();
  const messages = activeConv?.messages ?? [];

  // Auto-archive runs once per boot from every screen that can host it.
  useEffect(() => {
    void (async () => {
      const owner = await currentOwner(auth.user?.id ?? null);
      await runVaultSweepOnce({
        conversations, deleteConversation,
        backendUrl: settings.backendUrl, owner,
        toast: (t) => toast(t),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const empty = messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      {/* Identity line — 52px, quiet, never a dashboard header. */}
      <div className="mx-auto flex h-[52px] w-full max-w-[var(--chat-width)] shrink-0 items-center gap-2 px-4 sm:px-6">
        <h1 className="min-w-0 truncate text-ui font-medium text-[var(--fg-muted)]">
          {activeConv?.title || 'New chat'}
        </h1>

        {working && (
          <span className="flex shrink-0 items-center gap-1.5 text-small text-[var(--accent)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse-soft" />
            {statusText || (status === 'executing' ? 'Working' : 'Thinking')}
          </span>
        )}

        <span className="flex-1" />

        <AnimatePresence>
          {isGenerating && (
            <motion.button
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: duration.micro, ease: ease.precise }}
              onClick={stopGenerating}
              className="btn-ghost h-8 shrink-0 gap-1.5 px-3 text-small"
              aria-label="Stop generating"
            >
              <Square size={10} fill="currentColor" />
              Stop
            </motion.button>
          )}
        </AnimatePresence>

        <div className="relative shrink-0">
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className="icon-btn h-9 w-9"
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
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -2, scale: 0.99 }}
                  transition={{ duration: duration.small, ease: ease.out }}
                  className="absolute right-0 top-10 z-50 w-48 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-elevated)] p-1.5 shadow-pop"
                  role="menu"
                >
                  <MenuBtn icon={Plus} label="New chat" onClick={() => { newConversation(); setMoreOpen(false); }} />
                  <MenuBtn
                    icon={Pencil}
                    label="Rename"
                    onClick={() => {
                      setMoreOpen(false);
                      if (activeConv) openModal('rename-chat', { name: activeConv.title, onRename: (t: string) => renameConversation(activeConv.id, t) });
                    }}
                  />
                  <MenuBtn
                    icon={Trash2}
                    label="Delete"
                    danger
                    onClick={() => {
                      setMoreOpen(false);
                      if (activeConv) openModal('delete-chat', activeConv.id);
                    }}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* The conversation, or the question that starts one. */}
      {empty ? (
        <div className="scroll-region flex-1 min-h-0">
          <Welcome firstName={firstName} onPick={setMode} />
        </div>
      ) : (
        <ChatWindow messages={messages} />
      )}

      {/* Composer, grounded near the bottom. */}
      <div className="shrink-0 bg-[var(--bg)] pb-[74px] md:pb-3">
        <div className="mx-auto max-w-[var(--chat-width)] px-4 pt-2 sm:px-6">
          {offline && (
            <button
              onClick={() => setView('settings')}
              className="mb-2 block text-small text-[var(--fg-muted)] transition-colors duration-small ease-out hover:text-[var(--fg)]"
            >
              Local demo — answers come from a small offline model.{' '}
              <span className="text-[var(--accent)] underline underline-offset-2">Connect AI</span>
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
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-ui font-medium',
        'transition-colors duration-micro ease-out',
        danger ? 'text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]' : 'text-[var(--fg)] hover:bg-[var(--surface-hover)]',
      )}
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  );
}
