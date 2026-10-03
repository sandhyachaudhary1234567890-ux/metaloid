import { cn } from '../../lib/cn';

/**
 * ProviderMark — one normalised way to draw a third-party AI provider.
 *
 * Real provider logos are not shipped: they are third-party trademarks with
 * their own usage terms, and mixing half a dozen logo styles (some full-colour,
 * some wordmarks, some square) is exactly the visual noise §24 warns about.
 *
 * Instead every provider gets the same mark: a rounded square at one of three
 * sizes, a hairline border, and an optically centred monogram at a consistent
 * weight. Differentiation comes from the name, which is always adjacent — the
 * way a well-set directory does it. The accent is reserved for the provider
 * that is actually selected, so the eye only has one thing to find.
 */
export function ProviderMark({
  name,
  monogram,
  size = 36,
  active = false,
  className,
}: {
  name: string;
  /** Two characters at most. Falls back to the first letter of `name`. */
  monogram?: string;
  size?: 28 | 36 | 44;
  active?: boolean;
  className?: string;
}) {
  const text = (monogram || name.slice(0, 1)).slice(0, 2).toUpperCase();

  // Optical sizing: two glyphs read heavier than one, so they step down.
  const glyph = text.length > 1
    ? { 28: 'text-micro', 36: 'text-small', 44: 'text-ui' }[size]
    : { 28: 'text-small', 36: 'text-body', 44: 'text-title' }[size];

  const radius = { 28: 'rounded-[var(--radius-sm)]', 36: 'rounded-[var(--radius-md)]', 44: 'rounded-[var(--radius-lg)]' }[size];

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center border',
        radius,
        active
          ? 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
          : 'border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--fg-secondary)]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className={cn('font-semibold tracking-[0.02em] leading-none', glyph)}>{text}</span>
    </span>
  );
}

/**
 * ProviderCard — the directory row.
 *
 * Clean mark, provider name, one quiet status line, a short model summary and
 * a single action. No tables, no feature matrices, no coloured tags: those
 * live behind "Advanced details" when someone actually needs them.
 */
export function ProviderCard({
  name,
  monogram,
  summary,
  meta,
  active = false,
  badge,
  onClick,
  className,
}: {
  name: string;
  monogram?: string;
  /** One sentence about what this provider is good for. */
  summary?: string;
  /** Small facts: model count, free tier, key requirement. */
  meta?: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = (onClick ? 'button' : 'div') as 'button';

  return (
    <Tag
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={cn(
        'flex w-full items-start gap-3.5 rounded-[var(--radius-lg)] border p-3.5 text-left',
        'transition-colors duration-small ease-out',
        active
          ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
          : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
        className,
      )}
    >
      <ProviderMark name={name} monogram={monogram} size={36} active={active} />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ui font-medium text-[var(--fg)]">{name}</span>
          {badge && (
            <span className="rounded-full border border-[var(--border)] px-2 py-px text-micro font-medium text-[var(--fg-muted)]">
              {badge}
            </span>
          )}
        </span>
        {summary && <span className="mt-1 block text-small text-[var(--fg-muted)] text-pretty">{summary}</span>}
        {meta && <span className="mt-1.5 block text-small text-[var(--fg-subtle)]">{meta}</span>}
      </span>
    </Tag>
  );
}
