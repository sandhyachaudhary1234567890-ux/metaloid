import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { MetaIoidLockup } from './brand';
import { duration, ease } from '../design/motion';

/**
 * The opening beat.
 *
 * Boot is a hand-off, not a performance. The product is usually ready before
 * this finishes, so the sequence is deliberately under a second: the mark
 * settles, a hairline draws beneath it, and the whole thing fades out of the
 * way — revealing the workspace already in place underneath.
 *
 * It never blocks input: the overlay is pointer-transparent and the shell is
 * rendered behind it from the first frame.
 *
 * Timeline (900ms total):
 *   0–180ms   mark settles in from 0.96 with a soft rise
 *   140–520ms hairline draws outward
 *   520ms     the overlay begins to leave
 *   900ms     unmounted
 */
export function StartupSequence({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const fade = window.setTimeout(() => setLeaving(true), 520);
    const done = window.setTimeout(onDone, 900);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-[var(--bg)]"
      style={{ opacity: leaving ? 0 : 1, transition: `opacity 380ms ${ease.out}` }}
    >
      <div className="flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: duration.small, ease: ease.out }}
        >
          <MetaIoidLockup variant="full" size="md" />
        </motion.div>

        {/* A single hairline drawing outward. The only motion in the sequence
            beyond the mark — a line implies "starting", which a spinner cannot
            do without looking like a browser default. */}
        <motion.span
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: duration.large, ease: ease.out, delay: 0.14 }}
          className="mt-4 block h-px w-[132px] origin-center bg-[var(--border-strong)]"
        />
      </div>
    </div>
  );
}
