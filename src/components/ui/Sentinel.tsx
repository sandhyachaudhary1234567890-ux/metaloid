import { useEffect, useRef, useState } from 'react';

/**
 * Sentinel — reports whether it is on screen.
 *
 * Used to stop animations that nobody is looking at: the welcome artwork, the
 * voice orb's idle breath, the swept hairline on a running task. An animation
 * that keeps compositing off-screen is the most common way a "polished" UI
 * ends up feeling slow on a laptop.
 *
 * Returns a ref to attach and a boolean to gate on.
 */
export function useOnScreen<T extends HTMLElement>(rootMargin = '120px') {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, visible };
}

/**
 * A zero-height marker that renders its children only once scrolled near.
 *
 * Used for below-the-fold artwork and secondary panels so the first paint of a
 * screen carries only what the user can actually see.
 */
export function Sentinel({
  children,
  className,
  placeholderHeight,
}: {
  children: React.ReactNode;
  className?: string;
  /** Reserve space so deferred content cannot shift the layout when it lands. */
  placeholderHeight?: number;
}) {
  const { ref, visible } = useOnScreen<HTMLDivElement>();

  return (
    <div ref={ref} className={className} style={!visible && placeholderHeight ? { minHeight: placeholderHeight } : undefined}>
      {visible ? children : null}
    </div>
  );
}
