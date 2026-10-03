import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useApp } from '../lib/store';
import { useTaskActivity, simpleViewOf } from '../lib/activity';
import { ThinkingLinesSpinner } from './animations/ThinkingLinesSpinner';
import { cn } from '../lib/cn';

// Minimal one-line activity UI (ChatGPT-like). ONE compact line during work,
// tiny chevron for a compact safe summary. No timelines, no badges, no
// percentages, no chain-of-thought — ever. Updates only on real events.
export function LiveActivity() {
  const { liveTaskId, stopGenerating } = useApp();
  useTaskActivity(liveTaskId); // subscription only (re-render on real events)
  const [expanded, setExpanded] = useState(false);
  if (!liveTaskId) return null;
  const view = simpleViewOf(liveTaskId);
  if (!view) return null;

  const failed = view.state === 'ERROR';
  const done = view.state === 'DONE';

  return (
    <div className="py-1" role="status" aria-live="polite" aria-label={view.label}>
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse activity details' : 'Expand activity details'}
        className="group inline-flex max-w-full items-center gap-1.5 text-ui text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors"
      >
        {!done && !failed && (
          <ThinkingLinesSpinner size={18} lineColor="var(--fg-muted)" ballColor="var(--accent)" />
        )}
        {done && <Check size={13} className="text-success dark:text-success shrink-0" aria-hidden />}
        <span className="truncate font-medium">{view.label}</span>
        <ChevronDown
          size={13}
          className={cn('shrink-0 opacity-40 group-hover:opacity-70 transition-all', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>

      {expanded && view.lines.length > 0 && (
        <div className="mt-1.5 ml-[13px] border-l border-[var(--border)] pl-3 space-y-1">
          {view.lines.map((l, i) => (
            <div key={i}>
              <p className="text-small text-[var(--fg-secondary)] leading-snug">{l.label}</p>
              {l.detail && (
                <p className="text-micro text-[var(--fg-faint)] leading-snug break-words">{l.detail}</p>
              )}
            </div>
          ))}
          {!done && !failed && (
            <button
              onClick={stopGenerating}
              className="text-micro text-[var(--fg-faint)] hover:text-[var(--fg-muted)] underline underline-offset-2"
            >
              Stop
            </button>
          )}
        </div>
      )}
      {expanded && done && (
        <p className="mt-1 ml-[13px] text-micro text-[var(--fg-faint)]">Finished.</p>
      )}
    </div>
  );
}
