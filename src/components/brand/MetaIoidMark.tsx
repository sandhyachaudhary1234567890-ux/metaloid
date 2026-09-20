import React from 'react';
import { cn } from '../../lib/cn';

export interface MetaIoidMarkProps extends React.HTMLAttributes<HTMLElement> {
  size?: number;
  variant?: 'monochrome' | 'accent' | 'original';
  alt?: string;
}

/**
 * MetaIoidMark — Canonical brand symbol for MetaIoid.
 * Uses high-res cropped transparent asset with dark:invert for rock-solid
 * cross-browser rendering with zero mask failure risks.
 */
export const MetaIoidMark: React.FC<MetaIoidMarkProps> = ({
  size = 28,
  variant = 'monochrome',
  className,
  alt = 'MetaIoid Symbol',
  ...props
}) => {
  const width = Math.round(size * 1.4);
  const height = size;

  if (variant === 'accent') {
    return (
      <div
        role="img"
        aria-label={alt}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          maskImage: 'url(/brand/metaloid-mark.png)',
          WebkitMaskImage: 'url(/brand/metaloid-mark.png)',
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
      src="/brand/metaloid-mark.png"
      alt={alt}
      style={{ width: `${width}px`, height: `${height}px` }}
      className={cn(
        'inline-block object-contain shrink-0 select-none pointer-events-none transition-all duration-150 dark:invert',
        className
      )}
      {...(props as React.ImgHTMLAttributes<HTMLImageElement>)}
    />
  );
};
