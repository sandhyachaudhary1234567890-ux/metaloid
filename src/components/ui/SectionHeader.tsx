import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * SectionHeader — the single way a section announces itself.
 *
 * A quiet uppercase label with optional trailing action, and generous space
 * above it. Sections were previously announced four different ways (bold
 * sentence case, uppercase with wide tracking, uppercase with narrow tracking,
 * and a bordered bar), which made every screen feel assembled from parts.
 */
export function SectionHeader({
  title,
  hint,
  action,
  className,
  divider = false,
}: {
  title: string;
  /** One short line of context. Never a second heading. */
  hint?: string;
  /** A single trailing control — usually a link-style button. */
  action?: ReactNode;
  className?: string;
  divider?: boolean;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h3 className="label-caps">{title}</h3>
        {hint && <p className="mt-1 text-small text-[var(--fg-muted)] text-pretty">{hint}</p>}
      </div>
      {action && <div className="shrink-0 pb-0.5">{action}</div>}
      {divider && <span className="sr-only" />}
    </div>
  );
}
