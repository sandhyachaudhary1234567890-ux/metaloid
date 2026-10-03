import { cn } from '../../lib/cn';
import { art, type ArtKey } from '../../design/assets';

/**
 * Artwork — a piece from the MetaIoid visual library, presented as placed art.
 *
 * The source photographs sit on a mid-tone studio ground that matches neither
 * the dark nor the light page. Rather than feather them into the background
 * (which produces a visible vignette ring) they are framed: an inset tile with
 * a hairline border and the theme's own radius. It reads the same in both
 * themes, and it is honest — this is artwork in the interface, not a washed
 * out background.
 *
 * Always lazy unless it is above the fold, always sized, never a layout shift.
 */
export function Artwork({
  name,
  size = 148,
  priority = false,
  className,
  radius = 'lg',
  /** A very slight scale on hover — used where the art sits on a button. */
  interactive = false,
}: {
  name: ArtKey;
  size?: number;
  /** Set for the one image above the fold, so it is not deferred. */
  priority?: boolean;
  className?: string;
  radius?: 'sm' | 'md' | 'lg' | 'xl';
  interactive?: boolean;
}) {
  const item = art[name];
  const radiusClass = {
    sm: 'rounded-[var(--radius-sm)]',
    md: 'rounded-[var(--radius-md)]',
    lg: 'rounded-[var(--radius-lg)]',
    xl: 'rounded-[var(--radius-xl)]',
  }[radius];

  return (
    <span
      className={cn(
        'relative block shrink-0 overflow-hidden border border-[var(--border)] bg-[var(--surface-sunken)]',
        radiusClass,
        interactive && 'transition-transform duration-medium ease-out group-hover:scale-[1.02]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={item.src}
        srcSet={`${item.src} 1x, ${item.src2x} 2x`}
        width={item.width}
        height={item.height}
        alt=""
        aria-hidden
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        /* The ground in the artwork is a touch cooler than warm surfaces; a
           hair of desaturation keeps it from fighting the accent. */
        className="h-full w-full object-cover saturate-[0.94]"
      />
    </span>
  );
}
