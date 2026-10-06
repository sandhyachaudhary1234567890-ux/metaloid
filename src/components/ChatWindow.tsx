import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Pencil, ArrowDown, RotateCcw, Image as ImageIcon, FileText } from 'lucide-react';
import { AiSetupModal } from './setup/AiSetupModal';
import type { ChatMessage } from '../lib/types';
import { useApp } from '../lib/store';
import { Markdown } from './chat/Markdown';
import { MessageActions } from './chat/MessageActions';
import { formatSize } from './CommandBar';
import { MinimalActivity } from './MinimalActivity';
import { cn } from '../lib/cn';
import { ActivityStack, Activity, ToolActivity } from './ui/Activity';
import { duration, ease } from '../design/motion';

// THE CONVERSATION SURFACE
//
// The rule this file exists to enforce: an assistant message is a document,
// not a chat bubble. It has no container, no avatar and no chrome — just
// well-set prose at a book measure, with the tool steps that produced it
// stated quietly above and then got out of the way.
//
// User turns are the opposite: compact, right-aligned, visually closed, so the
// eye can always tell at a glance what it said and what MetaIoid said.

/* ─────────────────────────────────────────────────────────────────────────────
   Assistant
   ───────────────────────────────────────────────────────────────────────────── */

const AssistantTurn = memo(function AssistantTurn({
  msg,
  isLast,
  interactive = true,
}: {
  msg: ChatMessage;
  isLast: boolean;
  interactive?: boolean;
}) {
  const { toast, regenerate, setFeedback, setVersionIndex, retryFailed, isGenerating, connection, setView, recheckConnection } = useApp();
  const [setupOpen, setSetupOpen] = useState(false);
  const versions = msg.versions ?? [];
  const shown = msg.versionIndex !== undefined && msg.versionIndex >= 0 ? versions[msg.versionIndex] ?? msg.content : msg.content;
  const hasTool = (msg.toolActivity?.length ?? 0) > 0 && (msg.versionIndex === undefined || msg.versionIndex < 0);

  /* The provider setup, reachable from whatever is blocking the answer: a demo
     reply or a failed turn both end here, in place, instead of a trip through
     Settings the user has to search. */
  const setupModal = setupOpen ? (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-[620px] max-h-[92vh] overflow-y-auto">
        <AiSetupModal
          canSkip={true}
          onComplete={() => {
            setSetupOpen(false);
            void recheckConnection();
          }}
        />
      </div>
    </div>
  ) : null;

  /* ── Failure. Stated plainly, with the two things you can actually do. ── */
  if (msg.error && !msg.content) {
    // A stored key that cannot be decrypted has exactly one fix; say it and
    // offer it. The generic "no AI is connected" copy would be a lie here.
    const keyIssue = !!msg.errorText && /can no longer be decrypted|replace it|rejected (this|the) key|API key/i.test(msg.errorText);
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: duration.small, ease: ease.out }}
        className="max-w-[62ch] rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] px-4 py-3.5"
      >
        <p className="text-body font-medium text-[var(--fg)]">
          {keyIssue ? 'Your saved AI key needs replacing.' : "That reply didn't come through."}
        </p>
        <p className="mt-1 text-small text-[var(--fg-muted)] text-pretty">
          {msg.errorText
            ? msg.errorText
            : connection === 'online'
              ? 'The provider stopped mid-answer. Your message is still above.'
              : 'No AI is connected yet, so answers come from the local demo.'}
        </p>
        <span className="mt-3 flex items-center gap-2">
          <button onClick={() => retryFailed(msg.id)} className="btn-ghost h-8 gap-1.5 px-3 text-small">
            <RotateCcw size={12} />
            Try again
          </button>
          <button
            onClick={() => (keyIssue ? setSetupOpen(true) : setView('settings'))}
            className="btn-ghost h-8 px-3 text-small"
          >
            {keyIssue ? 'Replace your key' : 'Choose another AI'}
          </button>
        </span>
        {setupModal}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.medium, ease: ease.out }}
      className="group w-full min-w-0"
    >
      {msg.vision && (
        <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-0.5 text-micro tracking-[0.06em] text-[var(--fg-muted)]">
          <Eye size={11} strokeWidth={1.8} />
          Vision context
        </span>
      )}

      {/* Work that produced this answer. Collapses to nothing once the answer
          has arrived — the answer is the point, not the audit trail. */}
      {hasTool && (
        <ActivityStack visible={Boolean(msg.streaming) || !shown}>
          {msg.toolActivity!.map((t) => (
            <ToolActivity
              key={t.id}
              tool={t.tool}
              label={t.label}
              detail={t.detail}
              demo={t.demo}
              state={t.state === 'running' ? 'running' : 'done'}
            />
          ))}
        </ActivityStack>
      )}

      {/* Work in progress on this turn. Rendered in place of the answer so a
          deliverable being built is never an empty bubble. */}
      {msg.activity && !shown && (
        <MinimalActivity
          label={msg.activity.label}
          stages={msg.activity.stages}
          currentStageIndex={msg.activity.currentStageIndex}
          isComplete={msg.activity.isComplete}
          held={msg.activity.held}
        />
      )}

      {/* The reading surface. */}
      {shown ? (
        <Markdown text={shown} />
      ) : msg.streaming ? (
        <Activity label="Composing" />
      ) : null}

      {/* Demo replies say so, with the one tap that fixes it. Live replies
          show nothing — the absence of this line IS the live indicator.
          The tap opens the provider setup HERE, not a settings page the user
          then has to search: a demo reply is the moment they most want the
          fix, and it used to cost them a trip through Settings with no key
          control in sight. Gated on the CURRENT connection: an old demo bubble
          must never nag a user whose key is connected now. */}
      {!msg.streaming && msg.demo && shown && connection !== 'online' && (
        <p className="mt-2 text-small text-[var(--fg-muted)]">
          Demo reply — no AI connected.{' '}
          <button
            onClick={() => setSetupOpen(true)}
            className="text-[var(--accent)] underline underline-offset-2 hover:brightness-110"
          >
            Connect a key to go live
          </button>
        </p>
      )}

      {setupModal}

      {/* Streaming cursor — a soft bar, not a blinking block. */}
      {msg.streaming && shown && (
        <motion.span
          aria-hidden
          className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] rounded-full bg-[var(--accent)] align-baseline"
          animate={{ opacity: [1, 0.25, 1] }}
          transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {!msg.streaming && shown && interactive && (
        <div className="opacity-100 transition-opacity duration-medium ease-out md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
          <MessageActions
            content={shown}
            isLast={isLast}
            feedback={msg.feedback}
            versions={versions}
            versionIndex={msg.versionIndex ?? -1}
            onRegenerate={() => {
              if (!isGenerating) regenerate(msg.id);
              else toast({ title: 'Generation in progress', desc: 'Stop the active stream before regenerating' });
            }}
            onFeedback={(f) => setFeedback(msg.id, f)}
            onVersion={(i) => setVersionIndex(msg.id, i)}
          />
        </div>
      )}
    </motion.div>
  );
});

/* ─────────────────────────────────────────────────────────────────────────────
   User
   ───────────────────────────────────────────────────────────────────────────── */

const UserTurn = memo(function UserTurn({ msg, interactive = true }: { msg: ChatMessage; interactive?: boolean }) {
  const { editAndResend, isGenerating } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);

  if (editing) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.small }} className="flex justify-end">
        <div className="w-full max-w-[88%] rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--surface-elevated)] p-3 sm:max-w-[76%]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            aria-label="Edit message"
            className="max-h-[240px] min-h-[72px] w-full resize-y bg-transparent text-body leading-relaxed text-[var(--fg)] outline-none"
          />
          <div className="mt-2.5 flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-ghost h-8 px-3 text-small">
              Cancel
            </button>
            <button
              onClick={() => {
                if (!draft.trim() || isGenerating) return;
                setEditing(false);
                editAndResend(msg.id, draft);
              }}
              disabled={!draft.trim() || isGenerating}
              className="btn-primary h-8 px-3 text-small"
            >
              Save & resend
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.small, ease: ease.out }}
      className="group flex justify-end"
    >
      <div className="max-w-[88%] sm:max-w-[76%]">
        <div className="rounded-[var(--radius-lg)] rounded-br-[var(--radius-xs)] bg-[var(--surface)] px-4 py-2.5 text-body leading-relaxed text-[var(--fg)] ring-1 ring-inset ring-[var(--border-subtle)]">
          {msg.attachments?.length ? (
            <span className="mb-2 flex flex-wrap gap-2">
              {msg.attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-1.5 pr-2.5">
                  {a.kind === 'image' && a.dataUrl ? (
                    <img src={a.dataUrl} alt={a.name} className="h-10 w-10 rounded-[var(--radius-sm)] object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-elevated)]">
                      {a.type.startsWith('image/') ? (
                        <ImageIcon size={14} className="text-[var(--fg-muted)]" />
                      ) : (
                        <FileText size={14} className="text-[var(--fg-muted)]" />
                      )}
                    </span>
                  )}
                  <span className="max-w-[130px] min-w-0">
                    <span className="block truncate text-small font-medium text-[var(--fg)]">{a.name}</span>
                    <span className="block text-micro font-normal tracking-normal text-[var(--fg-muted)]">{formatSize(a.size)}</span>
                  </span>
                </span>
              ))}
            </span>
          ) : null}
          {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        </div>

        <div className="mt-1 flex items-center justify-end gap-1">
          {msg.edited && <span className="mr-1 text-micro font-normal tracking-normal text-[var(--fg-subtle)]">edited</span>}
          {interactive && (
            <button
              onClick={() => {
                setDraft(msg.content);
                setEditing(true);
              }}
              className="icon-btn h-7 w-7 opacity-100 transition-opacity duration-medium ease-out md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
              aria-label="Edit message"
              title="Edit and resend"
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
});

/* ─────────────────────────────────────────────────────────────────────────────
   Window
   ───────────────────────────────────────────────────────────────────────────── */

export function ThinkingDots({ label = 'Thinking…' }: { label?: string }) {
  return <Activity label={label.replace(/…$/, '')} />;
}

export function ChatWindow({ messages, live = false }: { messages: ChatMessage[]; live?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  const stickRef = useRef(true);
  const { status } = useApp();

  const atBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const onScroll = useCallback(() => {
    const near = atBottom();
    stickRef.current = near;
    setShowJump(!near);
  }, [atBottom]);

  const lastLen = messages[messages.length - 1]?.content?.length ?? 0;

  // Follow the conversation while the user is at the bottom, and stop the
  // moment they scroll away. Content that grows above the viewport is held in
  // place by `overflow-anchor`, so streaming never drags the reading position.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, lastLen, status]);

  useEffect(() => {
    if (messages.length === 0) {
      stickRef.current = true;
      setShowJump(false);
    }
  }, [messages.length]);

  const jump = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stickRef.current = true;
    setShowJump(false);
  };

  const lastAsstIdx = [...messages].map((m, i) => ({ m, i })).reverse().find((x) => x.m.role === 'assistant')?.i ?? -1;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="scroll-region flex-1 px-4 py-6 sm:px-6">
        <div className={cn('mx-auto flex flex-col gap-7', live ? 'max-w-[560px]' : 'max-w-[var(--chat-width)]')}>
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <UserTurn key={m.id} msg={m} interactive={!live} />
            ) : (
              <AssistantTurn key={m.id} msg={m} isLast={i === lastAsstIdx} interactive={!live} />
            ),
          )}
        </div>
      </div>

      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: duration.small, ease: ease.out }}
            onClick={jump}
            aria-label="Jump to latest messages"
            className="absolute bottom-4 left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3.5 text-small font-medium text-[var(--fg)] shadow-pop transition-colors duration-small ease-out hover:bg-[var(--surface-hover)]"
          >
            <ArrowDown size={13} />
            Latest
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
