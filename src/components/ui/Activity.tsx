import { AnimatePresence, motion } from 'framer-motion';
import { Check, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { duration, ease } from '../../design/motion';

/**
 * Activity — how MetaIoid reports that it is doing something.
 *
 * Two rules drive this component:
 *
 *  1. Never show a developer log. "fetch_sources(url=…)" is not an update, it
 *     is an implementation detail leaking into the product. The label is a
 *     human phrase; the detail is optional and also human.
 *
 *  2. Work resolves into its result. When the step finishes it does not vanish
 *     or turn into a permanent green tick collection — it settles, holds for a
 *     beat, and fades out of the way so the answer is what remains.
 */

export type ActivityState = 'running' | 'done' | 'failed';

/**
 * A restrained progress ring. 1.5px stroke, slow rotation, no glow. The arc
 * length is deliberately uneven — a perfectly symmetric spinner reads as a
 * browser default.
 */
function Ring({ state }: { state: ActivityState }) {
  if (state === 'done') {
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: duration.small, ease: ease.out }}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--surface-active)] text-[var(--fg-secondary)]"
      >
        <Check size={9} strokeWidth={2.5} />
      </motion.span>
    );
  }

  if (state === 'failed') {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center text-[var(--danger)]">
        <AlertCircle size={13} strokeWidth={2} />
      </span>
    );
  }

  return (
    <motion.svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      animate={{ rotate: 360 }}
      transition={{ duration: 1.6, ease: 'linear', repeat: Infinity }}
      aria-hidden
      className="text-[var(--accent)]"
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
      <path
        d="M7 1.5A5.5 5.5 0 0 0 1.5 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </motion.svg>
  );
}

/**
 * A single line of work. No card, no border, no chrome — it sits in the flow
 * of the conversation the way a stage direction sits in a script.
 */
export function Activity({
  label,
  detail,
  state = 'running',
  className,
}: {
  label: string;
  detail?: string;
  state?: ActivityState;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center gap-2.5 py-0.5', className)}
      role="status"
      aria-live="polite"
    >
      <Ring state={state} />
      <span
        className={cn(
          'text-small font-medium transition-colors duration-medium ease-out',
          state === 'running' ? 'text-[var(--fg-secondary)]' : 'text-[var(--fg-muted)]',
        )}
      >
        {label}
        {/* An ellipsis that reads as "in progress" without a spinner taking
            over the line. Hidden once the step resolves. */}
        {state === 'running' && <Ellipsis />}
      </span>
      {detail && state === 'running' && (
        <span className="min-w-0 truncate text-small text-[var(--fg-subtle)]">{detail}</span>
      )}
    </div>
  );
}

function Ellipsis() {
  return (
    <span aria-hidden className="inline-flex w-[0.9em] justify-start">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.16, ease: 'easeInOut' }}
        >
          .
        </motion.span>
      ))}
    </span>
  );
}

/**
 * ToolActivity — a named step that has a beginning and an end.
 *
 * Deliberately the same visual weight as `Activity`. A tool is not a bigger
 * event than thinking; it is just a step that happens to have a name.
 */
export function ToolActivity({
  tool,
  label,
  detail,
  state = 'running',
  demo = false,
  className,
}: {
  tool: string;
  label?: string;
  detail?: string;
  state?: ActivityState;
  demo?: boolean;
  className?: string;
}) {
  const text = state === 'running' ? label || tool : `${tool} ready`;

  return (
    <div
      className={cn('flex items-baseline gap-2.5 py-0.5', className)}
      role="status"
      aria-label={`${tool} ${state}`}
    >
      <span className="translate-y-[2px]">
        <Ring state={state} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-small font-medium',
              state === 'running' ? 'text-[var(--fg-secondary)]' : 'text-[var(--fg-muted)]',
            )}
          >
            {text}
          </span>
          {demo && (
            <span className="text-micro font-semibold tracking-[0.08em] text-[var(--fg-subtle)]">
              DEMO
            </span>
          )}
        </span>
        {detail && state === 'running' && (
          <span className="mt-0.5 block truncate text-small text-[var(--fg-subtle)]">{detail}</span>
        )}
      </span>
    </div>
  );
}

/**
 * The container that lets a strip of completed steps dissolve once the answer
 * arrives, rather than accumulating as a permanent audit trail.
 */
export function ActivityStack({ children, visible = true }: { children: React.ReactNode; visible?: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: duration.medium, ease: ease.out }}
          className="overflow-hidden"
        >
          <div className="flex flex-col gap-0.5 py-1">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
