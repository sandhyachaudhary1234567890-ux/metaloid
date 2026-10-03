import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Artwork } from './Artwork';
import type { ArtKey } from '../../design/assets';

/**
 * EmptyState — the art-directed way to say "there is nothing here yet".
 *
 * Structure is fixed on purpose: one piece of artwork, one headline, one
 * sentence, at most one action. No giant grey placeholder icon, no decorative
 * illustration standing in for the real thing, and no second competing button.
 *
 * `tone="blank"` drops the artwork for places where a picture would be noise —
 * an empty panel inside an already-busy screen.
 */
export function EmptyState({
  art,
  title,
  description,
  action,
  size = 'page',
  tone = 'art',
  className,
}: {
  art: ArtKey;
  title: string;
  description?: string;
  action?: ReactNode;
  /** `page` centres in a full screen; `inline` sits inside a panel. */
  size?: 'page' | 'inline';
  tone?: 'art' | 'blank';
  className?: string;
}) {
  const page = size === 'page';
  const imageSize = page ? 148 : 112;

  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        page ? 'px-6 py-16' : 'px-5 py-10',
        className,
      )}
    >
      {tone === 'art' && (
        <Artwork
          name={art}
          size={imageSize}
          radius="lg"
          className={cn(page ? 'mb-6' : 'mb-5', 'opacity-95')}
        />
      )}

      <h2
        className={cn(
          'text-[var(--fg)] text-balance',
          page ? 't-title' : 'text-ui font-medium',
        )}
      >
        {title}
      </h2>

      {description && (
        <p
          className={cn(
            'text-[var(--fg-muted)] text-pretty',
            page ? 'mt-1.5 text-body max-w-[38ch]' : 'mt-1 text-small max-w-[40ch]',
          )}
        >
          {description}
        </p>
      )}

      {action && <div className={cn(page ? 'mt-6' : 'mt-4')}>{action}</div>}
    </div>
  );
}
