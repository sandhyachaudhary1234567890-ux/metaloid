import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Square, MoreHorizontal, Pencil, Trash2, Plus, ArrowRight, Unplug } from 'lucide-react';
import { useApp } from '../lib/store';
import { ChatWindow } from '../components/ChatWindow';
import { CommandBar } from '../components/CommandBar';
import { MetaloidCore } from '../components/MetaloidCore';
import { ModelSelector } from '../components/ModelSelector';
import { LanguageSelector } from '../components/LanguageSelector';
import { greetingFor } from '../lib/i18n';

// CHAT — long-form conversation workspace.
// Editorial typography, calm surface treatments, sticky autoscroll,
// and zero bubble fatigue.

export function ChatScreen() {
  const {
    activeConv, status, isGenerating, stopGenerating, detectedLang,
    newConversation, setView, openModal, renameConversation, language,
    connection,
  } = useApp();
  const messages = activeConv?.messages ?? [];
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState<{ text: string; n: number } | null>(null);
  const draftN = useRef(0);
  const greet = greetingFor(new Date(), language);
  const offline = connection !== 'online';

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg)]">
      {/* top: title · model · language · more */}
      <div className="max-w-[760px] w-full mx-auto px-4 sm:px-8 pt-4 pb-2 flex items-center gap-3 border-b border-[var(--border-subtle)]">
        {messages.length <= 2 && (
          <div className="hidden sm:block shrink-0">
            <MetaloidCore status={status} size={40} glyph={false} minimal />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-[var(--fg)] truncate">{activeConv?.title ?? 'New conversation'}</h2>
          <p className="text-[12px] text-[var(--fg-muted)] truncate">
            {offline ? 'Local demo' : activeConv ? `${activeConv.model} · live` : 'live'}
            {activeConv ? ` · ${activeConv.language}` : ''}
            {detectedLang ? ` · Detected: ${detectedLang}` : ''} &middot; {messages.length} messages
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <ModelSelector compact />
          <LanguageSelector compact />
        </div>
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
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
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
        {isGenerating && (
          <button onClick={stopGenerating} className="btn-ghost h-8 px-3 text-[12.5px] shrink-0" aria-label="Stop generating">
            <Square size={12} fill="currentColor" /> Stop
          </button>
        )}
      </div>

      {/* honesty banner */}
      {offline && (
        <div className="max-w-[760px] w-full mx-auto px-4 sm:px-8 pt-3">
          <button
            onClick={() => setView('settings')}
            className="w-full flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-2 text-left hover:border-amber-500/40 transition-colors"
          >
            <Unplug size={14} className="text-amber-400 shrink-0" />
            <span className="text-[12px] text-[var(--fg-secondary)]">
              <span className="font-semibold text-amber-300">Local demo</span> &mdash; backend gateway not connected. Answers are local mocks.
              <span className="text-[var(--fg-muted)]"> Tap to connect &rarr;</span>
            </span>
          </button>
        </div>
      )}

      {messages.length === 0 ? (
        /* Clean welcome state */
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col justify-center max-w-[640px] w-full mx-auto px-6 py-10">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              <h1 className="font-bold tracking-tight text-[28px] sm:text-[34px] text-[var(--fg)]">
                {greet}, Aryan.
                <br />
                <span className="text-[var(--fg-muted)] font-normal text-[22px] sm:text-[26px]">What are we working on?</span>
              </h1>
              <p className="mt-3 text-[14px] text-[var(--fg-muted)]">
                Select a prompt below or type your inquiry to begin.
              </p>
              <div className="mt-6 grid sm:grid-cols-3 gap-2.5">
                {[
                  'Explain AI agents in simple language',
                  'Bhai, mujhe ye simple language mein samjha',
                  'Compare system architectures for fast latency',
                ].map((prompt, i) => (
                  <motion.button
                    key={prompt}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }}
                    onClick={() => {
                      draftN.current += 1;
                      setDraft({ text: prompt, n: draftN.current });
                    }}
                    className="group relative rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 pr-8 text-left text-[13px] leading-snug text-[var(--fg)] transition-all hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] min-h-[80px]"
                  >
                    {prompt}
                    <ArrowRight
                      size={14}
                      aria-hidden
                      className="absolute right-3 bottom-3 text-[var(--accent)] opacity-0 -translate-x-1.5 transition-all group-hover:opacity-100 group-hover:translate-x-0"
                    />
                    <span className="sr-only">Fill composer with suggestion</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      ) : (
        <ChatWindow messages={messages} />
      )}

      {/* bottom composer */}
      <div className="border-t border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md pb-[76px] md:pb-0">
        <div className="max-w-[760px] mx-auto px-4 sm:px-8 py-3.5">
          <CommandBar onCamera={() => setView('live')} injected={draft} />
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
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-[var(--fg)] hover:bg-[var(--surface-hover)]'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}
