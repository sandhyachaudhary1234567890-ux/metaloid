import { memo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Check, Loader2, Pencil, ArrowDown, RotateCcw, Image as ImageIcon, FileText } from 'lucide-react';
import type { ChatMessage } from '../lib/types';
import { useApp } from '../lib/store';
import { Markdown } from './chat/Markdown';
import { MessageActions } from './chat/MessageActions';
import { formatSize } from './CommandBar';
import { ThinkingLinesSpinner } from './animations/ThinkingLinesSpinner';
import { cn } from '../lib/cn';

// Editorial conversation surface: user turns are clean elevated prompt blocks,
// assistant turns are pure editorial typography. Intelligent autoscroll,
// quiet hover actions that stay accessible on touch.

function ToolCard({ t }: { t: NonNullable<ChatMessage['toolActivity']>[number] }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5" role="status">
      <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center border shrink-0',
        t.state === 'running' ? 'border-[var(--accent)] bg-[var(--accent-subtle)]' : 'border-emerald-500/25 bg-emerald-500/10')}>
        {t.state === 'running' ? <Loader2 size={13} className="animate-spin text-[var(--accent)]" /> : <Check size={13} className="text-emerald-400" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--fg)]">
          {t.state === 'running' ? t.label : `${t.tool} ready`}
          {t.demo && <span className="text-[10px] font-bold tracking-wider text-[var(--fg-muted)] border border-[var(--border)] rounded px-1.5 py-0.2">DEMO</span>}
        </span>
        <span className="block text-[11.5px] text-[var(--fg-muted)] truncate">{t.state === 'running' ? t.detail : 'Complete'}</span>
      </span>
      {t.state === 'running' && (
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />)}
        </span>
      )}
    </div>
  );
}

const UserBubble = memo(function UserBubble({ msg, interactive = true }: { msg: ChatMessage; interactive?: boolean }) {
  const { editAndResend, isGenerating } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);

  if (editing) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-end">
        <div className="w-full max-w-[84%] sm:max-w-[75%] rounded-2xl border border-[var(--accent)] bg-[var(--surface-elevated)] p-3 shadow-md">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            aria-label="Edit message"
            className="w-full bg-transparent resize-y outline-none text-[14.5px] leading-relaxed text-[var(--fg)] min-h-[72px] max-h-[220px]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-ghost h-8 px-3 text-[12.5px]">Cancel</button>
            <button
              onClick={() => {
                if (!draft.trim() || isGenerating) return;
                setEditing(false);
                editAndResend(msg.id, draft);
              }}
              disabled={!draft.trim() || isGenerating}
              className="btn-primary h-8 px-3 text-[12.5px] disabled:opacity-40"
            >
              Save & resend
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex justify-end group">
      <div className="max-w-[84%] sm:max-w-[75%]">
        <div className="rounded-2xl rounded-br-md bg-[var(--surface-elevated)] border border-[var(--border)] px-4 py-3 text-[14.5px] leading-relaxed text-[var(--fg)] shadow-sm">
          {msg.vision && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-md px-2 py-0.5 mb-2">
              <Eye size={12} /> CAMERA CAPTURE
            </span>
          )}
          {msg.attachments?.length ? (
            <span className="flex flex-wrap gap-2 mb-2">
              {msg.attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-1.5 pr-2.5">
                  {a.kind === 'image' && a.dataUrl ? (
                    <img src={a.dataUrl} alt={a.name} className="w-10 h-10 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="w-10 h-10 rounded-lg bg-[var(--surface-elevated)] flex items-center justify-center">
                      {a.type.startsWith('image/') ? <ImageIcon size={14} className="text-[var(--fg-muted)]" /> : <FileText size={14} className="text-[var(--fg-muted)]" />}
                    </span>
                  )}
                  <span className="min-w-0 max-w-[130px]">
                    <span className="block text-[12px] font-medium text-[var(--fg)] truncate">{a.name}</span>
                    <span className="block text-[11px] text-[var(--fg-muted)]">{formatSize(a.size)}</span>
                  </span>
                </span>
              ))}
            </span>
          ) : null}
          {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1">
          {msg.edited && <span className="text-[11px] text-[var(--fg-subtle)] mr-1">edited</span>}
          {interactive && (
            <button
              onClick={() => {
                setDraft(msg.content);
                setEditing(true);
              }}
              className="msg-actions icon-btn w-6 h-6" aria-label="Edit message" title="Edit and resend"
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
});

const AssistantBubble = memo(function AssistantBubble({ msg, isLast, interactive = true }: { msg: ChatMessage; isLast: boolean; interactive?: boolean }) {
  const { toast, regenerate, setFeedback, setVersionIndex, retryFailed, isGenerating } = useApp();
  const versions = msg.versions ?? [];
  const shown = msg.versionIndex !== undefined && msg.versionIndex >= 0 ? versions[msg.versionIndex] ?? msg.content : msg.content;
  const hasTool = (msg.toolActivity?.length ?? 0) > 0 && (msg.versionIndex === undefined || msg.versionIndex < 0);

  if (msg.error && !msg.content) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
        <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3 max-w-[94%] sm:max-w-[84%]">
          <p className="text-[13.5px] font-medium text-red-400">Response could not be completed.</p>
          <p className="text-[12.5px] text-[var(--fg-muted)] mt-1">The request was interrupted. Your input is preserved above.</p>
          <button onClick={() => retryFailed(msg.id)} className="btn-ghost h-8 px-3 text-[12.5px] mt-2.5">
            <RotateCcw size={12} /> Retry
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="flex justify-start group">
      <div className="max-w-[94%] sm:max-w-[84%] w-full min-w-0">
        {msg.vision && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-md px-2 py-0.5 mb-2">
            <Eye size={12} /> VISION CONTEXT
          </span>
        )}
        {hasTool && (
          <div className="mb-2.5 space-y-2">
            {msg.toolActivity!.map((t) => <ToolCard key={t.id} t={t} />)}
          </div>
        )}
        {shown ? (
          <Markdown text={shown} />
        ) : msg.streaming ? (
          <span className="inline-flex gap-1.5 py-2" role="status" aria-label="Generating">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--fg-muted)]"
                animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
          </span>
        ) : null}
        {msg.streaming && shown ? (
          <span className="inline-block w-[6px] h-[14px] ml-1 align-middle rounded-sm bg-[var(--accent)] animate-pulse" aria-label="Generating" />
        ) : null}
        {!msg.streaming && shown && interactive && (
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
        )}
        {!msg.streaming && msg.detectedLang && (
          <p className="text-[11px] text-[var(--fg-subtle)] mt-1">Detected: {msg.detectedLang}</p>
        )}
      </div>
    </motion.div>
  );
});

export function ThinkingDots({ label = 'Thinking…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-[13px] text-[var(--fg-muted)]" role="status" aria-live="polite">
      <ThinkingLinesSpinner size={24} lineColor="var(--accent)" ballColor="var(--fg)" />
      <span className="font-medium text-[var(--fg-secondary)]">{label}</span>
    </div>
  );
}

export function ChatWindow({ messages, live = false }: { messages: ChatMessage[]; live?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const { status, statusText } = useApp();
  const stickRef = useRef(true);
  stickRef.current = stick;

  const atBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const onScroll = () => {
    const near = atBottom();
    setStick(near);
    setShowJump(!near);
  };

  useEffect(() => {
    if (stickRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      setShowJump(true);
    }
  }, [messages.length, messages[messages.length - 1]?.content?.length]);

  useEffect(() => {
    setStick(true);
    setShowJump(false);
  }, [messages.length === 0]);

  const jump = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setStick(true);
    setShowJump(false);
  };

  const lastAsstIdx = [...messages].map((m, i) => ({ m, i })).reverse().find((x) => x.m.role === 'assistant')?.i ?? -1;

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
        <p className="text-[14.5px] text-[var(--fg)]">No messages yet.</p>
        <p className="text-[13px] text-[var(--fg-muted)] mt-1 max-w-[320px]">Ask a question or select a prompt below to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 relative flex flex-col" aria-live="polite">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        <div className={cn('mx-auto space-y-6', live ? 'max-w-[560px]' : 'max-w-[760px]')}>
          <AnimatePresence initial={false}>
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} msg={m} interactive={!live} />
              ) : (
                <AssistantBubble key={m.id} msg={m} isLast={i === lastAsstIdx} interactive={!live} />
              )
            )}
          </AnimatePresence>
          {status !== 'idle' && status !== 'error' && (
            <div className="pt-1"><ThinkingDots label={statusText} /></div>
          )}
        </div>
      </div>
      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            onClick={jump}
            aria-label="Jump to latest messages"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] shadow-pop text-[12.5px] font-medium text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <ArrowDown size={13} /> Latest
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
