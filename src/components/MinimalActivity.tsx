import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react';

export interface MinimalActivityProps {
  label: string;
  stages: string[];
  currentStageIndex: number;
  isComplete?: boolean;
  className?: string;
}

export function MinimalActivity({
  label,
  stages,
  currentStageIndex,
  isComplete = false,
  className = '',
}: MinimalActivityProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`my-2 max-w-[540px] text-left select-none ${className}`}>
      {/* Calm single-line header with chevron */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] transition-all text-[12.5px] font-medium text-[var(--fg-secondary)] shadow-sm"
        aria-expanded={expanded}
        aria-label="Toggle activity progress details"
      >
        {!isComplete ? (
          <Loader2 size={13} className="animate-spin text-[var(--accent)] shrink-0" />
        ) : (
          <span className="w-3.5 h-3.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Check size={10} strokeWidth={2.5} />
          </span>
        )}
        <span className="text-[var(--fg)]">{label}</span>
        <span className="text-[var(--fg-muted)] group-hover:text-[var(--fg)] transition-colors ml-0.5">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {/* Expandable calm step progression */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden mt-2 ml-2 pl-3 border-l-2 border-[var(--border)] space-y-1.5 py-1 text-[12px]"
          >
            {stages.map((stage, idx) => {
              const isPast = isComplete || idx < currentStageIndex;
              const isCurrent = !isComplete && idx === currentStageIndex;
              const isFuture = !isComplete && idx > currentStageIndex;

              return (
                <div
                  key={stage}
                  className={`flex items-center gap-2 transition-colors ${
                    isCurrent
                      ? 'text-[var(--fg)] font-medium'
                      : isPast
                      ? 'text-[var(--fg-secondary)]'
                      : 'text-[var(--fg-muted)] opacity-60'
                  }`}
                >
                  {isPast ? (
                    <span className="w-3.5 h-3.5 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                      <Check size={9} strokeWidth={2.5} />
                    </span>
                  ) : isCurrent ? (
                    <Loader2 size={12} className="animate-spin text-[var(--accent)] shrink-0" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--border-strong)] ml-1 shrink-0" />
                  )}
                  <span>{stage}</span>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
