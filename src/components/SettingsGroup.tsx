import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { duration, ease } from '../design/motion';

// SETTINGS PRIMITIVES
//
// Five parts, used everywhere. Settings used to be a developer configuration
// panel because each row invented its own control; now a row is a label, an
// optional sentence of explanation, and exactly one of Seg / Toggle / Select /
// Field. Nothing else is permitted.

/**
 * A section of settings.
 *
 * No icon chip in a bordered box — that read as a system preferences window.
 * The heading is typographic, separated by space rather than by another
 * container, which keeps the page from becoming a stack of cards.
 */
export function SettingsSection({
  title,
  desc,
  children,
  id,
}: {
  /** Kept optional so existing call sites that pass an icon keep compiling. */
  icon?: LucideIcon;
  title: string;
  desc: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <h3 className="t-title text-[var(--fg)]">{title}</h3>
      <p className="mt-1 max-w-[62ch] text-small text-[var(--fg-muted)] text-pretty">{desc}</p>
      <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="divide-y divide-[var(--border-subtle)] px-5">{children}</div>
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  control,
  stacked = false,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
  /** Put the control on its own line — for wide controls like a preset grid. */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex gap-3 py-4',
        stacked ? 'flex-col' : 'flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-[var(--fg)]">{label}</div>
        {hint && <div className="mt-0.5 max-w-[58ch] text-small text-[var(--fg-muted)] text-pretty">{hint}</div>}
      </div>
      <div className={cn('shrink-0', stacked && 'w-full')}>{control}</div>
    </div>
  );
}

/** A segmented control. The selected segment is raised, not accent-filled —
 *  six accent-filled pills on one page is how a settings screen starts to
 *  look like a form wizard. */
export function Seg<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: readonly T[] | T[];
  value: T;
  onPick: (v: T) => void;
  label?: string;
}) {
  return (
    <div
      className="flex gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-0.5"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => {
        const selected = value === o;
        return (
          <button
            key={o}
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(o)}
            className={cn(
              'min-h-[32px] rounded-[var(--radius-sm)] px-3 text-small font-medium',
              'transition-colors duration-micro ease-out',
              selected
                ? 'bg-[var(--surface-elevated)] text-[var(--fg)] shadow-raised'
                : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  on,
  onFlip,
  label,
}: {
  on: boolean;
  onFlip: () => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onFlip}
      className={cn(
        'relative h-[26px] w-[44px] shrink-0 rounded-full p-[3px]',
        'transition-colors duration-small ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]',
        on ? 'bg-[var(--accent-solid)]' : 'bg-[var(--surface-active)]',
      )}
    >
      <motion.span
        className="block h-5 w-5 rounded-full bg-white shadow-raised"
        animate={{ x: on ? 18 : 0 }}
        transition={{ duration: duration.small, ease: ease.precise }}
      />
    </button>
  );
}

/**
 * A styled `<select>`.
 *
 * The native control is kept for accessibility and mobile behaviour — a native
 * picker on a phone beats any custom listbox — but its chrome is removed so it
 * belongs to the product rather than to the browser.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={label}
        className={cn(
          'h-9 w-full cursor-pointer appearance-none rounded-[var(--radius-md)]',
          'border border-[var(--border)] bg-[var(--surface-elevated)]',
          'pl-3 pr-8 text-ui text-[var(--fg)]',
          'transition-colors duration-small ease-out hover:border-[var(--border-strong)]',
          'focus:border-[var(--accent)] focus:outline-none focus:ring-[3px] focus:ring-[var(--accent-subtle)]',
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[var(--surface)] text-[var(--fg)]">
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className="pointer-events-none absolute right-3 text-[var(--fg-muted)]"
      >
        <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
