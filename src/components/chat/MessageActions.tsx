import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Check, RotateCcw, ThumbsUp, ThumbsDown, MoreHorizontal, Volume2 } from 'lucide-react';
import { useApp } from '../../lib/store';
import { cn } from '../../lib/cn';

// Quiet contextual action row for assistant messages.
// Copy confirms inline (checkmark, no toast). Like/dislike persist locally.
// Hover-revealed on desktop, always reachable on touch.

export function MessageActions({
  content,
  isLast,
  feedback,
  versions,
  versionIndex,
  onRegenerate,
  onFeedback,
  onVersion,
}: {
  content: string;
  isLast: boolean;
  feedback?: 'up' | 'down';
  versions: string[];
  versionIndex: number;
  onRegenerate: () => void;
  onFeedback: (f: 'up' | 'down' | null) => void;
  onVersion: (i: number) => void;
}) {
  const { speakMessage, toast } = useApp();
  const [copied, setCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const total = versions.length + 1;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      toast({ title: 'Copy failed', desc: 'Clipboard unavailable in this browser' });
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const shownIndex = versionIndex < 0 ? versions.length : versionIndex;

  return (
    <div className="msg-actions mt-1.5 flex items-center gap-0.5">
      <ActBtn
        label={copied ? 'Copied' : 'Copy response'}
        onClick={copy}
        active={copied}
      >
        {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
      </ActBtn>
      {isLast && (
        <ActBtn label="Regenerate response" onClick={onRegenerate}>
          <RotateCcw size={13} />
        </ActBtn>
      )}
      <ActBtn
        label={feedback === 'up' ? 'Remove like' : 'Like response'}
        onClick={() => onFeedback(feedback === 'up' ? null : 'up')}
        active={feedback === 'up'}
      >
        <ThumbsUp size={13} className={feedback === 'up' ? 'text-[var(--accent)]' : undefined} fill={feedback === 'up' ? 'currentColor' : 'none'} />
      </ActBtn>
      <ActBtn
        label={feedback === 'down' ? 'Remove dislike' : 'Dislike response'}
        onClick={() => onFeedback(feedback === 'down' ? null : 'down')}
        active={feedback === 'down'}
      >
        <ThumbsDown size={13} className={feedback === 'down' ? 'text-red-400' : undefined} fill={feedback === 'down' ? 'currentColor' : 'none'} />
      </ActBtn>
      <div className="relative">
        <ActBtn label="More actions" onClick={() => setMoreOpen((o) => !o)} active={moreOpen}>
          <MoreHorizontal size={13} />
        </ActBtn>
        <AnimatePresence>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 bottom-9 z-50 w-44 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-lg p-1"
                role="menu"
              >
                <button
                  role="menuitem"
                  onClick={() => { setMoreOpen(false); speakMessage(content); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-[var(--fg)] hover:bg-[var(--surface-hover)]"
                >
                  <Volume2 size={14} className="text-[var(--fg-muted)]" /> Speak aloud
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setMoreOpen(false); copy(); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-[var(--fg)] hover:bg-[var(--surface-hover)]"
                >
                  <Copy size={14} className="text-[var(--fg-muted)]" /> Copy text
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
      {total > 1 && (
        <span className="ml-2 inline-flex items-center gap-1 text-[11.5px] text-[var(--fg-muted)]" aria-label={`Version ${shownIndex + 1} of ${total}`}>
          <button
            onClick={() => onVersion(Math.max(0, shownIndex - 1))}
            disabled={shownIndex === 0}
            className="icon-btn w-6 h-6 disabled:opacity-30" aria-label="Previous version"
          >‹</button>
          <span className="font-mono">{shownIndex + 1} / {total}</span>
          <button
            onClick={() => onVersion(Math.min(versions.length, shownIndex + 1))}
            disabled={shownIndex === versions.length}
            className="icon-btn w-6 h-6 disabled:opacity-30" aria-label="Next version"
          >›</button>
        </span>
      )}
    </div>
  );
}

function ActBtn({
  label, onClick, active, children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'icon-btn w-7 h-7 min-w-[28px] min-h-[28px]',
        active && 'text-[var(--fg)]'
      )}
    >
      {children}
    </button>
  );
}
