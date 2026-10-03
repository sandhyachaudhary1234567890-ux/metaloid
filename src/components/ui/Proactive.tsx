import { motion } from 'framer-motion';
import { ArrowRight, Lightbulb } from 'lucide-react';
import { MetaIoidNoticedEngine } from '../../lib/ready/metaIoidNoticed';
import { useApp } from '../../lib/store';
import { duration, ease } from '../../design/motion';

/**
 * Proactive — the two things MetaIoid says before you ask.
 *
 * These are the product's best ideas: it remembers an unfinished task, and it
 * notices a pattern in your recent work. They were previously rendered as two
 * competing status cards above a WebGL hero, which buried them.
 *
 * Now they are a short stack of quiet rows that sits directly under the
 * welcome headline, and only ever appears when there is something real to say.
 * Absent data means absent UI — never an empty shell with a placeholder.
 */
export function Proactive() {
  const { setView, setToolsOpen } = useApp();
  const pickUp = MetaIoidNoticedEngine.getPickUpContext();
  const notices = MetaIoidNoticedEngine.getNotices();
  const notice = notices[0];

  const hasPickUp = Boolean(pickUp?.hasOpenWork);
  if (!hasPickUp && !notice) return null;

  return (
    <div className="mt-7 flex w-full flex-col gap-2">
      {hasPickUp && pickUp && (
        <Row
          delay={0.1}
          label="Pick up where you left off"
          body={pickUp.subtitle}
          meta={pickUp.lastActiveStep ? `${pickUp.lastActiveStep} · ${pickUp.progressPercent}%` : `${pickUp.progressPercent}%`}
          actionLabel="Continue"
          onAction={() => setView('chat')}
        />
      )}

      {notice && (
        <Row
          delay={hasPickUp ? 0.14 : 0.1}
          label="MetaIoid noticed"
          body={notice.message}
          actionLabel={notice.actionLabel}
          onAction={() =>
            notice.type === 'open_loop' ? setView('chat') : setToolsOpen(true)
          }
          icon
        />
      )}
    </div>
  );
}

function Row({
  delay,
  label,
  body,
  meta,
  actionLabel,
  onAction,
  icon = false,
}: {
  delay: number;
  label: string;
  body: string;
  meta?: string;
  actionLabel?: string;
  onAction: () => void;
  icon?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.medium, ease: ease.out, delay }}
      className="group flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-left transition-colors duration-small ease-out hover:border-[var(--border-strong)]"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-[var(--accent)]">
        {icon ? <Lightbulb size={14} strokeWidth={1.8} /> : <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-micro font-semibold text-[var(--fg-muted)]">{label}</span>
        <span className="mt-0.5 block truncate text-ui text-[var(--fg)]">{body}</span>
        {meta && <span className="mt-0.5 block truncate text-small text-[var(--fg-subtle)]">{meta}</span>}
      </span>

      {actionLabel && (
        <button
          onClick={onAction}
          className="btn-ghost h-8 shrink-0 gap-1 px-3 text-small"
        >
          {actionLabel}
          <ArrowRight size={12} className="transition-transform duration-medium ease-out group-hover:translate-x-0.5" />
        </button>
      )}
    </motion.div>
  );
}
