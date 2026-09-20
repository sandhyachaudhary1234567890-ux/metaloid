import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

// Settings primitives — clean, accessible, theme-reactive controls.

export function SettingsSection({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0">
          <Icon size={18} className="text-[var(--fg)]" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-[var(--fg)]">{title}</h3>
          <p className="text-[12.5px] text-[var(--fg-muted)]">{desc}</p>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium text-[var(--fg)]">{label}</div>
        {hint && <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

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
      className="flex gap-1 p-1 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)]"
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
              'px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-all min-h-[34px]',
              selected
                ? 'bg-[var(--surface-elevated)] text-[var(--fg)] shadow-sm border border-[var(--border)]'
                : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'
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
        'w-11 h-[26px] rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        on ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
      )}
    >
      <motion.span
        layout
        className="block w-5 h-5 rounded-full bg-white shadow-sm"
        animate={{ x: on ? 18 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}
