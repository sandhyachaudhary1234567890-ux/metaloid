import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Check, Pause, Loader2 } from 'lucide-react';
import { duration, ease } from '../design/motion';
import { cn } from '../lib/cn';

export interface MinimalActivityProps {
  label: string;
  stages: string[];
  currentStageIndex: number;
  isComplete?: boolean;
  /** Held by the user: the work stopped here and can be resumed. */
  held?: boolean;
  className?: string;
}

/**
 * The staged progression of a piece of work, inside the assistant turn.
 *
 * One quiet line at rest — a label and a chevron — that expands into the steps
 * on request. It exists so a deliverable being built is never a blank bubble:
 * the user can see what is happening, and, when they stop it, that the work is
 * held rather than lost.
 *
 * The visual language is the same one `Activity` uses everywhere else: the same
 * ring for running, the same settled disc for done, no second vocabulary.
 */
export function MinimalActivity({
  label,
  stages,
  currentStageIndex,
  isComplete = false,
  held = false,
  className = '',
}: MinimalActivityProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn('my-2 max-w-[540px] select-none text-left', className)}>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="group inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-small font-medium text-[var(--fg-secondary)] transition-colors duration-small ease-out hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
        aria-expanded={expanded}
        aria-label="Toggle work progress details"
      >
        {held ? (
          <Pause size={12} strokeWidth={2} className="shrink-0 text-[var(--fg-muted)]" />
        ) : isComplete ? (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-active)] text-[var(--success)]">
            <Check size={9} strokeWidth={2.5} />
          </span>
        ) : (
          <Loader2 size={13} className="shrink-0 animate-spin text-[var(--accent)]" />
        )}
        <span className="text-[var(--fg)]">{label}</span>
        <span className="ml-0.5 text-[var(--fg-muted)] transition-colors duration-small ease-out group-hover:text-[var(--fg)]">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: duration.small, ease: ease.out }}
            className="ml-2 mt-2 space-y-1.5 overflow-hidden border-l-2 border-[var(--border)] py-1 pl-3 text-small"
          >
            {stages.map((stage, idx) => {
              const past = isComplete || held || idx < currentStageIndex;
              const current = !isComplete && !held && idx === currentStageIndex;

              return (
                <div
                  key={stage}
                  className={cn(
                    'flex items-center gap-2 transition-colors duration-medium ease-out',
                    current ? 'font-medium text-[var(--fg)]' : past ? 'text-[var(--fg-secondary)]' : 'text-[var(--fg-muted)] opacity-60',
                  )}
                >
                  {past ? (
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-active)] text-[var(--success)]">
                      <Check size={9} strokeWidth={2.5} />
                    </span>
                  ) : current ? (
                    <Loader2 size={12} className="shrink-0 animate-spin text-[var(--accent)]" />
                  ) : (
                    <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--border-strong)]" />
                  )}
                  <span>{stage}</span>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
