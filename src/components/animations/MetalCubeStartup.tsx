import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * MetalCubeStartup — Type 1: 3D Reflection Metal Cube Startup Animation (code-20260920-163216)
 * Rotates 360° for 4 seconds on startup with engraved METALOID brand plates,
 * reflection floor, and precision loading progress bar.
 */
export function MetalCubeStartup({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // Exact 4-second run as requested
    const timer = setTimeout(() => {
      setFading(true);
      setTimeout(onDone, 450); // allow fade out
    }, 4000);

    return () => clearTimeout(timer);
  }, [onDone]);

  const handleSkip = () => {
    setFading(true);
    setTimeout(onDone, 200);
  };

  return (
    <AnimatePresence>
      {!fading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#030405] text-[#eef0ef] overflow-hidden select-none"
          role="status"
          aria-label="Metaloid startup animation"
        >
          {/* Subtle scanline overlay */}
          <div
            className="absolute inset-0 z-[4] pointer-events-none opacity-[0.13]"
            style={{
              background: 'repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,0.12) 4px)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Vignette */}
          <div
            className="absolute inset-0 z-[3] pointer-events-none"
            style={{ boxShadow: 'inset 0 0 12vw 4vw #000' }}
          />

          {/* Radial ambient background */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at 50% 48%, rgba(49, 56, 59, 0.7) 0%, rgba(13, 16, 18, 0.82) 32%, #020303 78%), linear-gradient(110deg, #0a0c0d, #202427 48%, #050606)',
            }}
          />

          {/* 3D Scene Container */}
          <div
            className="relative w-full h-full flex items-center justify-center"
            style={{ perspective: 'clamp(420px, 70vw, 850px)' }}
          >
            {/* Monitor / Camera Setup */}
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                transformStyle: 'preserve-3d',
                transform: 'rotateX(-7deg) rotateY(-18deg)',
              }}
            >
              {/* Scaled Cube Wrapper */}
              <div
                style={{
                  transformStyle: 'preserve-3d',
                  transform: 'scale(1.18, 0.78)',
                }}
              >
                {/* 360° Rotating Group (4s continuous turn) */}
                <div
                  className="startup-cube-rotation"
                  style={{
                    transformStyle: 'preserve-3d',
                    animation: 'startupCubeRotate 4000ms linear infinite',
                  }}
                >
                  {/* Face A */}
                  <CubeFace label="METALOID" transform="rotateY(0deg) translateZ(clamp(56px, min(10vw, 17dvh), 125px))" delay="-400ms" />
                  {/* Face B */}
                  <CubeFace label="METALOID" transform="rotateY(180deg) translateZ(clamp(56px, min(10vw, 17dvh), 125px))" delay="1600ms" />
                  {/* Face C */}
                  <CubeFace label="METALOID" transform="rotateY(90deg) translateZ(clamp(56px, min(10vw, 17dvh), 125px))" delay="600ms" />
                  {/* Face D */}
                  <CubeFace label="METALOID" transform="rotateY(-90deg) translateZ(clamp(56px, min(10vw, 17dvh), 125px))" delay="2600ms" />

                  {/* Floor Shadow */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(clamp(112px, min(20vw, 34dvh), 250px) / -2)',
                      left: 'calc(clamp(112px, min(20vw, 34dvh), 250px) / -2)',
                      width: 'clamp(112px, min(20vw, 34dvh), 250px)',
                      height: 'clamp(112px, min(20vw, 34dvh), 250px)',
                      background: 'rgba(0,0,0,0.75)',
                      filter: 'blur(30px)',
                      transform: 'rotateX(-90deg) translateZ(130px) scale(0.92)',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Bottom Copy: Loading + Progress bar */}
            <div className="absolute bottom-[8%] inset-x-0 flex flex-col items-center gap-2.5 z-10 pointer-events-none">
              <span
                className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.45em] pl-[0.45em] text-[#dce7ee]/90"
                style={{ textShadow: '0 0 12px rgba(185, 215, 232, 0.35)' }}
              >
                LOADING
              </span>
              <div className="w-[min(180px,28vw)] h-[1px] bg-white/20 overflow-hidden">
                <div
                  className="w-[45%] h-full bg-[#0ea5e9]"
                  style={{ animation: 'startupProgressBar 2000ms ease-in-out infinite' }}
                />
              </div>
            </div>

            {/* Skip Button */}
            <button
              onClick={handleSkip}
              className="absolute top-6 right-6 z-20 text-[11px] font-medium tracking-wider uppercase text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full transition-all"
            >
              Skip
            </button>
          </div>

          <style>{`
            @keyframes startupCubeRotate {
              from { transform: rotateY(0deg); }
              to { transform: rotateY(-360deg); }
            }
            @keyframes startupFaceReflection {
              0% { transform: translateX(-100%); }
              90%, 100% { transform: translateX(100%); }
            }
            @keyframes startupProgressBar {
              0% { transform: translateX(-110%); }
              65%, 100% { transform: translateX(240%); }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CubeFace({ label, transform, delay }: { label: string; transform: string; delay: string }) {
  const cubeSize = 'clamp(112px, min(20vw, 34dvh), 250px)';
  const halfCube = `calc(${cubeSize} / -2)`;

  return (
    <div
      style={{
        position: 'absolute',
        top: halfCube,
        left: halfCube,
        width: cubeSize,
        height: cubeSize,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        background:
          'linear-gradient(115deg, rgba(255,255,255,0.25), transparent 25%, transparent 68%, rgba(0,0,0,0.5)), linear-gradient(-30deg, #101315, #697074 46%, #1d2225)',
        boxShadow:
          'inset 0 0 0 1px rgba(255,255,255,0.3), inset 0 0 35px rgba(0,0,0,0.8), 0 0 25px rgba(0,0,0,0.5)',
        transform,
      }}
    >
      {/* Specular reflection sweep */}
      <div
        style={{
          position: 'absolute',
          top: '-150%',
          width: '300%',
          height: '300%',
          background: 'radial-gradient(closest-side, #fff 0%, #fff 18%, #333 100%)',
          filter: 'blur(50px)',
          transform: 'translateX(-100%)',
          animation: 'startupFaceReflection 4000ms ease-out infinite',
          animationDelay: delay,
          pointerEvents: 'none',
        }}
      />

      {/* Engraved METALOID brand badge */}
      <div
        className="relative z-[1] flex items-center justify-center w-[79%] py-3.5 px-2 text-[#f3f1e9]"
        style={{
          border: '1px solid rgba(255,255,255,0.65)',
          outline: '1px solid rgba(0,0,0,0.9)',
          outlineOffset: '-5px',
          background: 'linear-gradient(145deg, rgba(255,255,255,0.2), rgba(0,0,0,0.38))',
          boxShadow:
            '0 2px 0 rgba(255,255,255,0.25), 0 -2px 0 #000, 0 9px 16px rgba(0,0,0,0.55), inset 0 0 14px rgba(255,255,255,0.1)',
          font: '800 clamp(10px, 1.35vw, 17px)/1 Arial, sans-serif',
          letterSpacing: '0.25em',
          textShadow: '0 1px 0 #fff, 0 -1px 0 #555, 1px 3px 3px #000',
          transform: 'translateZ(2px)',
        }}
      >
        {/* Corner alignment ticks */}
        <span
          className="absolute -top-[5px] -left-[5px] w-[13px] h-[13px] border-t border-l border-[#0ea5e9]"
          style={{ filter: 'drop-shadow(1px 1px 1px #000)' }}
        />
        <span
          className="absolute -bottom-[5px] -right-[5px] w-[13px] h-[13px] border-b border-r border-[#0ea5e9]"
          style={{ filter: 'drop-shadow(1px 1px 1px #000)' }}
        />
        {label}
      </div>
    </div>
  );
}
