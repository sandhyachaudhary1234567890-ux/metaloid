import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';

/**
 * DeviceMorphPreview — Type 3: 360° Rotating Morphing Device (code-20260920-164226)
 * Used when a new feature / page call is triggered.
 * Appears for exactly 4 seconds while rotating 360° and morphing across device forms.
 */
export function DeviceMorphPreview({
  isOpen,
  onClose,
  featureName = 'New Feature Showcase',
}: {
  isOpen: boolean;
  onClose: () => void;
  featureName?: string;
}) {
  const [remaining, setRemaining] = useState(4);

  useEffect(() => {
    if (!isOpen) return;
    setRemaining(4);

    const countdown = setInterval(() => {
      setRemaining((r) => (r > 1 ? r - 1 : 1));
    }, 1000);

    const timer = setTimeout(() => {
      onClose();
    }, 4000);

    return () => {
      clearInterval(countdown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md select-none"
          role="dialog"
          aria-label="Responsive Device Morph Animation"
        >
          {/* Dismiss button */}
          <button
            onClick={onClose}
            className="absolute top-6 right-6 z-20 icon-btn w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/15"
            aria-label="Close preview"
          >
            <X size={16} />
          </button>

          <div className="flex flex-col items-center justify-center max-w-[800px] w-full">
            {/* Header notification */}
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--surface-elevated)] border border-[var(--border)] text-[12px] text-[var(--fg)] mb-6 shadow-sm">
              <Sparkles size={13} className="text-[var(--accent)]" />
              <span>{featureName}</span>
              <span className="text-[var(--fg-muted)]">· {remaining}s</span>
            </div>

            {/* 3D Perspective Canvas */}
            <div
              className="relative w-full max-w-[620px] aspect-[10/7] flex items-center justify-center"
              style={{
                perspective: 'clamp(650px, 100vw, 1400px)',
              }}
            >
              <div
                className="w-full h-full flex items-center justify-center"
                style={{
                  transform: 'rotateY(-25deg)',
                  transformStyle: 'preserve-3d',
                }}
              >
                {/* 360 Morphing Device Container */}
                <figure
                  className="morphing-device"
                  style={{
                    position: 'relative',
                    animation: 'morphDevice 4000ms infinite cubic-bezier(1, 0.015, 0.295, 1.225)',
                    transformOrigin: 'center',
                    backfaceVisibility: 'hidden',
                  }}
                >
                  {/* Sheen overlay */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.12), transparent 42%, rgba(0,0,0,0.2))',
                    }}
                  />

                  {/* Device Status / Notch Buttons */}
                  <div
                    className="morphing-buttons"
                    style={{
                      position: 'absolute',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      animation: 'morphButtons 4000ms infinite cubic-bezier(1, 0.015, 0.295, 1.225)',
                    }}
                  />

                  {/* Dynamic Centered Brand Label */}
                  <span
                    className="morphing-label"
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      zIndex: 2,
                      maxWidth: '90%',
                      color: 'rgba(255, 255, 255, 0.95)',
                      fontFamily: 'system-ui, sans-serif',
                      fontSize: 'clamp(0.65rem, 3vw, 1.5rem)',
                      fontWeight: 800,
                      letterSpacing: '0.25em',
                      lineHeight: 1,
                      textShadow: '0 0 14px rgba(255, 255, 255, 0.4)',
                      animation: 'keepLabelReadable 4000ms infinite cubic-bezier(1, 0.015, 0.295, 1.225)',
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                    }}
                  >
                    METALOID
                  </span>
                </figure>
              </div>
            </div>

            {/* 4-second Progress Indicator */}
            <div className="w-48 h-1 bg-white/10 rounded-full mt-8 overflow-hidden">
              <motion.div
                className="h-full bg-[var(--accent)] rounded-full"
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: 4, ease: 'linear' }}
              />
            </div>
          </div>

          <style>{`
            @keyframes morphDevice {
              0%, 15% {
                width: 100%; height: 100%; margin-top: 0;
                border: 2px solid #0ea5e9;
                border-radius: 12px;
                box-shadow: 10px 10px 0 -2px rgba(10,12,16,0.9), 10px 10px 0 rgba(255,255,255,0.15);
                transform: rotate(0deg);
              }
              25%, 40% {
                width: 70%; height: 78.5%; margin-top: 10.75%;
                border: 2px solid #38bdf8;
                border-radius: 16px;
                box-shadow: 9px -9px 0 -2px rgba(10,12,16,0.9), 9px -9px 0 rgba(255,255,255,0.15);
                transform: rotate(90deg);
              }
              50%, 65% {
                width: 32%; height: 62%; margin-top: 18%;
                border: 2px solid #f1f5f9;
                border-radius: 20px;
                box-shadow: -8px -8px 0 -2px rgba(10,12,16,0.9), -8px -8px 0 rgba(255,255,255,0.15);
                transform: rotate(180deg);
              }
              75%, 90% {
                width: 58%; height: 95%; margin-top: 2%;
                border: 2px solid #34d399;
                border-radius: 14px;
                box-shadow: -9px 9px 0 -2px rgba(10,12,16,0.9), -9px 9px 0 rgba(255,255,255,0.15);
                transform: rotate(270deg);
              }
              100% {
                width: 100%; height: 100%; margin-top: 0;
                border: 2px solid #0ea5e9;
                border-radius: 12px;
                box-shadow: 10px 10px 0 -2px rgba(10,12,16,0.9), 10px 10px 0 rgba(255,255,255,0.15);
                transform: rotate(360deg);
              }
            }

            @keyframes morphButtons {
              0%, 15%, 100% {
                top: 12px; left: 12px; margin: 0;
                background: #0ea5e9;
                box-shadow: 15px 0 0 rgba(255,255,255,0.15), 30px 0 0 rgba(255,255,255,0.15);
                transform: scale(1);
              }
              25%, 40% {
                top: 50%; left: 100%; margin: -5px 0 0 -20px;
                background: #38bdf8;
                box-shadow: 0 0 0 350px rgba(255,255,255,0.05), 0 0 0 100px transparent;
                transform: scale(0.9);
              }
              50%, 65% {
                top: 10px; left: 50%; margin: 0 0 0 -5px;
                background: #f1f5f9;
                box-shadow: 0 -30px 0 rgba(255,255,255,0.05), 0 -60px 0 rgba(255,255,255,0.05);
                transform: scale(0.8);
              }
              75%, 90% {
                top: 100%; left: 50%; margin: -20px 0 0 -5px;
                background: #34d399;
                box-shadow: 0 0 0 350px rgba(255,255,255,0.05), 0 0 0 100px transparent;
                transform: scale(0.9);
              }
            }

            @keyframes keepLabelReadable {
              0%, 15% { transform: translate(-50%, -50%) rotate(0deg); }
              25%, 40% { transform: translate(-50%, -50%) rotate(-90deg); }
              50%, 65% { transform: translate(-50%, -50%) rotate(-180deg); }
              75%, 90% { transform: translate(-50%, -50%) rotate(-270deg); }
              100% { transform: translate(-50%, -50%) rotate(-360deg); }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
