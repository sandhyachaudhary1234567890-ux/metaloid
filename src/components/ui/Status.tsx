import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Status — one dot, one pill, used everywhere a state is reported.
 *
 * The app previously had half a dozen hand-rolled status treatments with
 * different dot sizes, different greens, and different caps treatments, which
 * is one of the fastest ways for a product to read as unfinished. There are
 * now three tones and two sizes, and nothing else.
 */

export type StatusTone = 'positive' | 'caution' | 'neutral' | 'negative';

const DOT: Record<StatusTone, string> = {
  positive: 'bg-[var(--success)]',
  caution: 'bg-[var(--warning)]',
  neutral: 'bg-[var(--fg-subtle)]',
  negative: 'bg-[var(--danger)]',
};

const TEXT: Record<StatusTone, string> = {
  positive: 'text-[var(--success)]',
  caution: 'text-[var(--warning)]',
  neutral: 'text-[var(--fg-muted)]',
  negative: 'text-[var(--danger)]',
};

/**
 * A single indicator dot.
 *
 * `pulse` is reserved for states that are genuinely in transition — connecting,
 * generating, listening. A steady state that pulses everywhere stops meaning
 * anything.
 */
export function StatusDot({
  tone = 'neutral',
  pulse = false,
  size = 6,
  className,
}: {
  tone?: StatusTone;
  pulse?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-full', DOT[tone], pulse && 'animate-pulse-soft', className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * A dot with a label, in a bordered pill. Used for connection state, model
 * availability, task status — anything that needs to be scannable at a glance
 * without becoming a badge collection.
 */
export function StatusPill({
  tone = 'neutral',
  label,
  pulse = false,
  compact = false,
  className,
  as = 'span',
  ...rest
}: {
  tone?: StatusTone;
  label: ReactNode;
  pulse?: boolean;
  compact?: boolean;
  className?: string;
  as?: 'span' | 'button';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const Tag = as as 'span';

  return (
    <Tag
      {...(as === 'button' ? rest : {})}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] font-medium whitespace-nowrap',
        compact ? 'px-2 py-[3px] text-micro tracking-[0.06em]' : 'px-2.5 py-1 text-small',
        TEXT[tone],
        as === 'button' && 'transition-colors duration-small ease-out hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
        className,
      )}
    >
      <StatusDot tone={tone} pulse={pulse} size={compact ? 5 : 6} />
      {label}
    </Tag>
  );
}
