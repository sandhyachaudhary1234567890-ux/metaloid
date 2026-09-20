import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * BlockSwitchingTransition — Block Switching Animation (code-20260920-163741)
 * The main transition animation for page switching and heavy process execution.
 * Enforces a minimum of 1.25s (1250ms) to ensure the fluid metallic block shuffling is appreciated,
 * and caps at 5s (5000ms) if genuine background processing takes time.
 */
export function BlockSwitchingTransition({
  active,
  minDuration = 1250,
  maxDuration = 5000,
  label = 'METALOID',
  hint,
  onComplete,
}: {
  active: boolean;
  minDuration?: number;
  maxDuration?: number;
  label?: string;
  hint?: string;
  onComplete?: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let minTimer: ReturnType<typeof setTimeout>;
    let maxTimer: ReturnType<typeof setTimeout>;

    if (active) {
      setVisible(true);
      const startTime = Date.now();

      // Enforce max duration safety
      maxTimer = setTimeout(() => {
        setVisible(false);
        onComplete?.();
      }, maxDuration);

      return () => {
        const elapsed = Date.now() - startTime;
        if (elapsed < minDuration) {
          minTimer = setTimeout(() => {
            setVisible(false);
            onComplete?.();
          }, minDuration - elapsed);
        } else {
          setVisible(false);
          onComplete?.();
        }
        clearTimeout(maxTimer);
      };
    } else {
      setVisible(false);
    }

    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, [active, minDuration, maxDuration, onComplete]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--bg)]/90 backdrop-blur-md select-none"
          role="status"
          aria-label="Loading page"
        >
          <div className="flex flex-col items-center gap-6 max-w-[320px] w-full text-center">
            {/* 4 Shuffling Boxes Loader */}
            <div className="relative w-24 h-24 sm:w-28 sm:h-28">
              {/* Radial back glow */}
              <div
                className="absolute -inset-4 rounded-full bg-[var(--accent)]/15 blur-xl pointer-events-none"
              />

              {/* Box 1 (Top Left) */}
              <div
                className="block-switching-box"
                style={{
                  top: '4%',
                  left: '4%',
                  animationDelay: '0s',
                }}
              />

              {/* Box 2 (Top Right) */}
              <div
                className="block-switching-box"
                style={{
                  top: '4%',
                  right: '4%',
                  animationDelay: '-0.25s',
                }}
              />

              {/* Box 3 (Bottom Right) */}
              <div
                className="block-switching-box"
                style={{
                  bottom: '4%',
                  right: '4%',
                  animationDelay: '-0.5s',
                }}
              />

              {/* Box 4 (Bottom Left) */}
              <div
                className="block-switching-box"
                style={{
                  bottom: '4%',
                  left: '4%',
                  animationDelay: '-0.75s',
                }}
              />
            </div>

            {/* Brand Title */}
            <div>
              <div
                className="text-[14px] sm:text-[15px] font-bold text-[var(--fg)] tracking-[0.35em] uppercase text-center pl-[0.35em]"
                style={{
                  textShadow: '0 0 16px var(--accent-glow)',
                }}
              >
                {label}
              </div>
              {hint && (
                <div className="text-[12px] text-[var(--fg-muted)] mt-1 tracking-wide">
                  {hint}
                </div>
              )}
            </div>
          </div>

          <style>{`
            .block-switching-box {
              position: absolute;
              width: 44%;
              height: 44%;
              border: 1px solid rgba(255, 255, 255, 0.25);
              border-radius: 4px;
              background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(200, 210, 220, 0.6) 58%, rgba(140, 150, 165, 0.8));
              box-shadow: 0 0 10px rgba(14, 165, 233, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.9);
              opacity: 0;
              animation: blockSwitchingLoad 1s linear infinite;
              will-change: opacity;
            }

            @keyframes blockSwitchingLoad {
              0%, 30% { opacity: 0; transform: scale(0.96); }
              85% { opacity: 1; transform: scale(1); }
              100% { opacity: 0; transform: scale(0.96); }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
