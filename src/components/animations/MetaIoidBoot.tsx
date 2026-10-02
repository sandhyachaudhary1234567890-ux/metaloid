import { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MetaIoidMark } from '../brand/MetaIoidMark';
import { useApp } from '../../lib/store';

export type BootStage = 'BOOT' | 'INITIALIZING' | 'VERIFYING' | 'LIVE' | 'ENTER_APP' | 'DEGRADED';

interface CapabilityStatus {
  id: string;
  name: string;
  checked: boolean;
  status: 'pending' | 'ok' | 'degraded';
  detail?: string;
}

export function MetaIoidBoot({ onDone }: { onDone: () => void }) {
  const { connection, settings } = useApp();
  const [stage, setStage] = useState<BootStage>('BOOT');
  const [fading, setFading] = useState(false);
  const [micListeningPermitted, setMicListeningPermitted] = useState(false);

  // Check if returning user within recent session (warm start)
  const isWarmStart = useMemo(() => {
    try {
      const last = localStorage.getItem('metaloid_last_active');
      if (last) {
        const diff = Date.now() - parseInt(last, 10);
        // Warm start if active within last 2 hours
        return diff < 2 * 60 * 60 * 1000;
      }
    } catch {
      // ignore
    }
    return false;
  }, []);

  const [capabilities, setCapabilities] = useState<CapabilityStatus[]>([
    { id: 'model', name: 'Model', checked: false, status: 'pending' },
    { id: 'voice', name: 'Voice', checked: false, status: 'pending' },
    { id: 'memory', name: 'Memory', checked: false, status: 'pending' },
    { id: 'research', name: 'Research', checked: false, status: 'pending' },
    { id: 'browser', name: 'Browser', checked: false, status: 'pending' },
    { id: 'storage', name: 'Storage', checked: false, status: 'pending' },
    { id: 'companion', name: 'Companion', checked: false, status: 'pending' },
  ]);

  const finishedRef = useRef(false);

  const finishBoot = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    try {
      localStorage.setItem('metaloid_last_active', Date.now().toString());
    } catch {
      // ignore
    }
    setFading(true);
    setTimeout(onDone, 380);
  };

  useEffect(() => {
    // Escape key skips immediately
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishBoot();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Capability inspection & state progression
  useEffect(() => {
    let cancelled = false;

    async function inspectCapabilities() {
      // 1. Storage check
      let storageOk = false;
      try {
        localStorage.setItem('__mt_test', '1');
        localStorage.removeItem('__mt_test');
        storageOk = true;
      } catch {
        storageOk = false;
      }

      // 2. Browser check
      const browserOk = typeof window !== 'undefined' && 'fetch' in window && 'ReadableStream' in window;

      // 3. Memory check (local store available)
      const memoryOk = typeof indexedDB !== 'undefined' || storageOk;

      // 4. Voice check (Web Speech or MediaDevices)
      let voiceOk = false;
      let micPermitted = false;
      try {
        if ('mediaDevices' in navigator && navigator.mediaDevices.getUserMedia) {
          voiceOk = true;
          if (navigator.permissions && navigator.permissions.query) {
            const p = await navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null);
            if (p && p.state === 'granted') {
              micPermitted = true;
            }
          }
        } else if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
          voiceOk = true;
        }
      } catch {
        voiceOk = false;
      }

      if (!cancelled) setMicListeningPermitted(micPermitted);

      // 5. Research check (online connection)
      const researchOk = navigator.onLine !== false;

      // 6. Model check (online backend or local demo)
      const modelOk = connection === 'online' || !!settings.backendUrl;

      // 7. Companion check
      const companionOk = true;

      return {
        model: modelOk ? 'ok' : 'degraded',
        voice: voiceOk ? 'ok' : 'degraded',
        memory: memoryOk ? 'ok' : 'degraded',
        research: researchOk ? 'ok' : 'degraded',
        browser: browserOk ? 'ok' : 'degraded',
        storage: storageOk ? 'ok' : 'degraded',
        companion: companionOk ? 'ok' : 'degraded',
      } as const;
    }

    if (isWarmStart) {
      // Warm start: 1.2s ultra fast progression
      setStage('BOOT');
      const t1 = setTimeout(() => setStage('LIVE'), 400);
      const t2 = setTimeout(() => {
        setStage('ENTER_APP');
        finishBoot();
      }, 1300);

      return () => {
        cancelled = true;
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }

    // Cold start: 4.2 - 5s controlled progression
    inspectCapabilities().then((realStatus) => {
      if (cancelled) return;

      // Stage 1: BOOT (0 - 600ms)
      setStage('BOOT');

      // Stage 2: INITIALIZING (at 700ms)
      const tInit = setTimeout(() => {
        if (cancelled) return;
        setStage('INITIALIZING');

        // Reveal capabilities sequentially
        const step = 280;
        const keys: (keyof typeof realStatus)[] = ['model', 'voice', 'memory', 'research', 'browser', 'storage', 'companion'];

        keys.forEach((key, index) => {
          setTimeout(() => {
            if (cancelled) return;
            setCapabilities((prev) =>
              prev.map((c) =>
                c.id === key ? { ...c, checked: true, status: realStatus[key] } : c
              )
            );

            // Once last is checked, move to LIVE state
            if (index === keys.length - 1) {
              const hasDegraded = Object.values(realStatus).includes('degraded');
              setTimeout(() => {
                if (cancelled) return;
                setStage(hasDegraded ? 'DEGRADED' : 'LIVE');

                // Stage 5: ENTER_APP handoff
                setTimeout(() => {
                  if (cancelled) return;
                  setStage('ENTER_APP');
                  finishBoot();
                }, 1400);
              }, 400);
            }
          }, (index + 1) * step);
        });
      }, 700);

      return () => {
        clearTimeout(tInit);
      };
    });

    return () => {
      cancelled = true;
    };
  }, [isWarmStart, connection, settings.backendUrl]);

  return (
    <AnimatePresence>
      {!fading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#050608] text-[#e8eaec] select-none overflow-hidden font-sans"
          role="status"
          aria-label="MetaIoid initialization"
        >
          {/* Subtle vignette and ambient lighting */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at 50% 46%, rgba(25, 30, 36, 0.5) 0%, rgba(8, 10, 12, 0.85) 55%, #050608 100%)',
            }}
          />

          {/* Top Skip Button */}
          <button
            onClick={finishBoot}
            className="absolute top-6 right-6 z-20 text-[11px] font-medium tracking-wider uppercase text-zinc-500 hover:text-zinc-200 bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 px-3 py-1.5 rounded-full transition-all"
            aria-label="Skip startup animation"
          >
            Skip
          </button>

          {/* Central Experience */}
          <div className="relative z-10 flex flex-col items-center justify-center max-w-[340px] w-full px-6">
            {/* MetaIoid Brand Mark */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex items-center justify-center"
            >
              <MetaIoidMark size={44} variant="monochrome" className="opacity-95" />
            </motion.div>

            {/* Typography: MetaIoid */}
            <motion.div
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-4 text-center"
            >
              <h1 className="text-[17px] font-semibold tracking-[0.16em] uppercase text-zinc-200">
                MetaIoid
              </h1>
            </motion.div>

            {/* Stage 3: System Initialization Checks */}
            {!isWarmStart && (stage === 'INITIALIZING' || stage === 'BOOT') && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-8 w-full max-w-[210px] space-y-1.5"
              >
                <div className="text-[10.5px] uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-2 text-center">
                  Initializing
                </div>
                {capabilities.map((cap) => (
                  <div
                    key={cap.id}
                    className="flex items-center justify-between text-[12.5px] leading-tight text-zinc-400 py-0.5"
                  >
                    <span className="font-normal text-zinc-300">{cap.name}</span>
                    <span className="w-4 text-right">
                      {cap.checked ? (
                        cap.status === 'ok' ? (
                          <motion.span
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="text-zinc-200 font-medium"
                          >
                            ✓
                          </motion.span>
                        ) : (
                          <motion.span
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="text-amber-400/90 font-medium text-[11px]"
                            title="Degraded capability"
                          >
                            ⚠️
                          </motion.span>
                        )
                      ) : (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-700 animate-pulse" />
                      )}
                    </span>
                  </div>
                ))}
              </motion.div>
            )}

            {/* Stage 4: The Live State */}
            {(stage === 'LIVE' || stage === 'DEGRADED' || stage === 'ENTER_APP' || isWarmStart) && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mt-8 text-center flex flex-col items-center"
              >
                <div className="inline-flex items-center gap-2 text-[12.5px] font-semibold tracking-[0.14em] uppercase text-zinc-200">
                  <span>METAIOID</span>
                  <span className="text-zinc-500 font-normal">|</span>
                  <span className="inline-flex items-center gap-1.5 text-zinc-100">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        stage === 'DEGRADED' ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{
                        animation: 'metaIoidBreathe 2.4s ease-in-out infinite',
                        boxShadow:
                          stage === 'DEGRADED'
                            ? '0 0 10px rgba(251, 191, 36, 0.4)'
                            : '0 0 10px rgba(52, 211, 153, 0.4)',
                      }}
                    />
                    LIVE
                  </span>
                </div>
                <p className="mt-2 text-[13px] text-zinc-400 font-normal">
                  {micListeningPermitted ? 'Ready · Listening for you' : 'Ready'}
                </p>
              </motion.div>
            )}
          </div>

          {/* Gentle Bottom Anchor */}
          <div className="absolute bottom-8 inset-x-0 flex justify-center pointer-events-none">
            <span className="text-[11px] tracking-wider text-zinc-600 uppercase font-medium">
              Personal Operating Layer
            </span>
          </div>

          <style>{`
            @keyframes metaIoidBreathe {
              0%, 100% { opacity: 0.7; transform: scale(0.92); }
              50% { opacity: 1; transform: scale(1.08); }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
