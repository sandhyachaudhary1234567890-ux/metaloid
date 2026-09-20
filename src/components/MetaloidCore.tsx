import { motion } from 'framer-motion';
import type { AgentStatus } from '../lib/types';
import { cn } from '../lib/cn';

// MetaloidCore — engineered physical-digital interface instrument.
// Precision-machined titanium bezel, acoustic/orbital state telemetry,
// and platinum M glyph. Calm, responsive, and free of gaudy neon or sci-fi gimmicks.

const M_GLYPH = 'M7 26 L7 9 L16 19 L25 9 L25 26';

export function MetaloidCore({
  status = 'idle',
  size = 216,
  glyph = true,
  platform = false,
  minimal = false,
  label,
}: {
  status?: AgentStatus;
  size?: number;
  glyph?: boolean;
  platform?: boolean;
  minimal?: boolean;
  label?: string;
}) {
  const isSmall = size < 80 || minimal;

  // Semantic state color mappings
  const stateColor =
    status === 'error'
      ? '#ef4444'
      : status === 'listening' || status === 'speaking'
      ? 'var(--accent)'
      : status === 'thinking' || status === 'executing'
      ? 'var(--accent)'
      : status === 'vision'
      ? '#38bdf8'
      : 'var(--accent)';

  return (
    <div
      role="img"
      aria-label={label ?? `MetaIoid status: ${status}`}
      className="relative flex flex-col items-center justify-center select-none"
      style={{ width: size, height: platform ? size + Math.round(size * 0.14) : size }}
    >
      {/* Outer instrument chassis */}
      <motion.div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
        }}
        animate={
          status === 'idle'
            ? { scale: [1, 1.012, 1] }
            : status === 'listening'
            ? { scale: [1, 1.025, 1] }
            : status === 'speaking'
            ? { scale: [1, 1.03, 0.99, 1.02, 1] }
            : { scale: 1 }
        }
        transition={{
          duration: status === 'idle' ? 4.5 : status === 'speaking' ? 1.2 : 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        {/* Subtle acoustic pulse ring on listening */}
        {(status === 'listening' || status === 'speaking') && !isSmall && (
          <motion.div
            className="absolute -inset-2.5 rounded-full border border-[var(--accent)] opacity-20"
            animate={{ scale: [1, 1.08, 1], opacity: [0.15, 0.35, 0.15] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Outer machined bezel */}
        <div
          className="absolute inset-0 rounded-full border border-[var(--border-strong)] bg-[var(--surface-elevated)]"
          style={{
            boxShadow:
              'inset 0 1px 1px 0 rgba(255,255,255,0.1), 0 8px 24px -6px rgba(0,0,0,0.25)',
          }}
        />

        {/* Precision orbital track for thinking/executing */}
        {(status === 'thinking' || status === 'executing') && (
          <motion.div
            className="absolute inset-1 rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          >
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
              style={{ backgroundColor: stateColor, boxShadow: `0 0 10px ${stateColor}` }}
            />
          </motion.div>
        )}

        {/* Inner acoustic / optical chamber */}
        <div
          className="relative flex items-center justify-center rounded-full overflow-hidden border border-[var(--border)] bg-[var(--surface-sunken)]"
          style={{
            width: size - (isSmall ? 8 : 28),
            height: size - (isSmall ? 8 : 28),
          }}
        >
          {/* Subtle concentric calibration rings (engineered feel) */}
          {!isSmall && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20" aria-hidden>
              <div className="w-3/4 h-3/4 rounded-full border border-[var(--border-strong)]" />
              <div className="w-1/2 h-1/2 rounded-full border border-[var(--border-subtle)]" />
            </div>
          )}

          {/* Speaking acoustic waveform */}
          {status === 'speaking' ? (
            <div className="flex items-center justify-center gap-1.5 z-10">
              {[0.4, 0.8, 1.2, 0.7, 1.1, 0.5].map((d, i) => (
                <span
                  key={i}
                  className="w-1 rounded-full bg-[var(--accent)] wave-bar"
                  style={{
                    height: isSmall ? 12 : 28,
                    animationDelay: `${i * 0.1}s`,
                    animationDuration: `${0.8 + d * 0.25}s`,
                  }}
                />
              ))}
            </div>
          ) : glyph ? (
            /* Precision Platinum M Glyph */
            <div className="relative flex items-center justify-center z-10">
              <svg
                width={size * (isSmall ? 0.38 : 0.26)}
                height={size * (isSmall ? 0.38 : 0.26)}
                viewBox="0 0 32 32"
                fill="none"
                aria-hidden
              >
                <defs>
                  <linearGradient id={`mg-${size}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--fg)" />
                    <stop offset="100%" stopColor="var(--fg-secondary)" />
                  </linearGradient>
                </defs>
                <path
                  d={M_GLYPH}
                  stroke={`url(#mg-${size})`}
                  strokeWidth={isSmall ? '4' : '3.4'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          ) : (
            /* Minimalist telemetry dot when glyph is omitted */
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{
                backgroundColor: stateColor,
                boxShadow: `0 0 8px ${stateColor}`,
              }}
            />
          )}

          {/* Vision mode subtle optical grid */}
          {status === 'vision' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
              <div className="w-full h-px bg-[#38bdf8]/30" />
              <div className="h-full w-px bg-[#38bdf8]/30" />
            </div>
          )}
        </div>
      </motion.div>

      {/* Grounding platform / milled base */}
      {platform && (
        <div
          className="mt-3.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)]"
          style={{
            width: Math.round(size * 0.72),
            height: 10,
            boxShadow: '0 8px 20px -4px rgba(0,0,0,0.3)',
          }}
        />
      )}
    </div>
  );
}
