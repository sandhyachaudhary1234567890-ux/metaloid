import React from 'react';
import { MetaIoidMark } from './MetaIoidMark';
import { MetaIoidWordmark } from './MetaIoidWordmark';
import { cn } from '../../lib/cn';

export interface MetaIoidLockupProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'full' | 'compact' | 'live' | 'mark-only' | 'badge';
  statusText?: string;
  isLive?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * MetaIoidLockup — Unified branding lockup for MetaIoid.
 * Integrates mark, wordmark, and optional live runtime state.
 */
export const MetaIoidLockup: React.FC<MetaIoidLockupProps> = ({
  variant = 'full',
  statusText = 'LIVE',
  isLive = true,
  size = 'md',
  className,
  ...props
}) => {
  const markSize = size === 'sm' ? 20 : size === 'lg' ? 36 : 26;
  const wordmarkHeight = size === 'sm' ? 14 : size === 'lg' ? 24 : 18;

  if (variant === 'mark-only') {
    return (
      <div className={cn('inline-flex items-center', className)} {...props}>
        <MetaIoidMark size={markSize} />
      </div>
    );
  }

  if (variant === 'badge') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)]/80 backdrop-blur-md shadow-sm',
          className
        )}
        {...props}
      >
        <MetaIoidMark size={18} />
        <MetaIoidWordmark height={14} />
      </div>
    );
  }

  if (variant === 'live') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)]/80 backdrop-blur-md shadow-sm',
          className
        )}
        {...props}
      >
        <MetaIoidMark size={size === 'sm' ? 18 : 22} />
        <MetaIoidWordmark height={size === 'sm' ? 13 : 16} />
        <span className="text-[var(--border-strong)] mx-0.5">|</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-emerald-400">
          <span className={cn('w-1.5 h-1.5 rounded-full bg-emerald-400', isLive && 'animate-pulse')} />
          {statusText}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 select-none',
        variant === 'compact' ? 'gap-1.5' : 'gap-2.5',
        className
      )}
      {...props}
    >
      <MetaIoidMark size={markSize} />
      <MetaIoidWordmark height={wordmarkHeight} />
    </div>
  );
};
