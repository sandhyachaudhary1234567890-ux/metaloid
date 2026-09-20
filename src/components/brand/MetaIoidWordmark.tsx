import React from 'react';
import { cn } from '../../lib/cn';

export interface MetaIoidWordmarkProps extends React.HTMLAttributes<HTMLElement> {
  height?: number;
  variant?: 'monochrome' | 'accent' | 'original';
  alt?: string;
}

/**
 * MetaIoidWordmark — Canonical typographic wordmark for MetaIoid.
 * Uses cropped transparent asset with dark:invert for rock-solid
 * cross-browser rendering with zero mask failure risks.
 */
export const MetaIoidWordmark: React.FC<MetaIoidWordmarkProps> = ({
  height = 18,
  variant = 'monochrome',
  className,
  alt = 'MetaIoid Wordmark',
  ...props
}) => {
  const width = Math.round(height * 8.09);

  if (variant === 'accent') {
    return (
      <div
        role="img"
        aria-label={alt}
        style={{
          height: `${height}px`,
          width: `${width}px`,
          maskImage: 'url(/brand/metaloid-wordmark.png)',
          WebkitMaskImage: 'url(/brand/metaloid-wordmark.png)',
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
        className={cn('inline-block shrink-0 select-none bg-[var(--accent)]', className)}
        {...props}
      />
    );
  }

  // Monochrome & default: Direct img with dark:invert ensures 100% foolproof rendering
  return (
    <img
      src="/brand/metaloid-wordmark.png"
      alt={alt}
      style={{ height: `${height}px`, width: `${width}px` }}
      className={cn(
        'inline-block object-contain shrink-0 select-none pointer-events-none transition-all duration-150 dark:invert',
        className
      )}
      {...(props as React.ImgHTMLAttributes<HTMLImageElement>)}
    />
  );
};
