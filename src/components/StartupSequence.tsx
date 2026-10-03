import { useEffect, useState } from 'react';
import { MetaIoidLockup } from './brand';

/**
 * Boot is a hand-off, not a performance.
 *
 * The old intro held a four-second 3D cube in front of the product; the app
 * was ready long before it let you in. This is a short, calm brand beat that
 * fades out of the way and never blocks typing: it renders above the shell,
 * is pointer-transparent, and is gone in well under a second.
 */
export function StartupSequence({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), 520);
    const done = setTimeout(onDone, 900);
    return () => { clearTimeout(fade); clearTimeout(done); };
  }, [onDone]);

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--bg)] pointer-events-none"
      style={{
        opacity: leaving ? 0 : 1,
        transition: 'opacity 380ms ease',
      }}
    >
      <div className="animate-[fadeIn_400ms_ease]">
        <MetaIoidLockup variant="full" size="lg" />
      </div>
    </div>
  );
}
