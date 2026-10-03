import { motion } from 'framer-motion';
import type { AgentStatus } from '../lib/types';
import { cn } from '../lib/cn';

/**
 * MetaloidCore — the voice orb.
 *
 * MetaIoid's signature moment, so it is built as a physical object rather than
 * a UI control: a soft lens of light sitting in a shallow well, with the
 * accent appearing only as a rim and a breath.
 *
 * What it deliberately is NOT:
 *   · a gamer visualiser — no equaliser bars, no neon, no hard glows
 *   · sci-fi hardware — no machined bezels, orbital tracks or "telemetry"
 *   · decoration that ignores the microphone
 *
 * It reacts to real signal. Pass `level` (0–1, from the mic or the TTS
 * analyser) and the orb breathes with the actual voice rather than a random
 * number generator, which is the difference between an instrument and an
 * animation.
 *
 * States: ready · listening · thinking · speaking · interrupted.
 */

const M_GLYPH = 'M7 25 L7 9 L16 20 L25 9 L25 25';

/** A per-state read of what the orb is doing. One table, one source of truth. */
const STATE = {
  idle: { breath: 1.01, duration: 5.2, rim: 0.10 },
  listening: { breath: 1.0, duration: 0, rim: 0.30 },
  thinking: { breath: 1.008, duration: 3.6, rim: 0.22 },
  executing: { breath: 1.008, duration: 3.6, rim: 0.22 },
  speaking: { breath: 1.0, duration: 0, rim: 0.34 },
  vision: { breath: 1.006, duration: 4.2, rim: 0.24 },
  error: { breath: 1.0, duration: 0, rim: 0.18 },
} as const;

export function MetaloidCore({
  status = 'idle',
  size = 216,
  glyph = true,
  minimal = false,
  label,
  /** Live amplitude, 0–1. Mic energy while listening, TTS energy while speaking. */
  level,
}: {
  status?: AgentStatus;
  size?: number;
  glyph?: boolean;
  /** Kept for call-site compatibility; the orb scales from `size` alone now. */
  platform?: boolean;
  minimal?: boolean;
  label?: string;
  level?: number;
}) {
  const isSmall = size < 90 || minimal;
  const s = STATE[status] ?? STATE.idle;
  const amp = Math.max(0, Math.min(1, level ?? 0));

  // Live states follow the signal; the rest follow their own slow breath.
  const isLive = (status === 'listening' || status === 'speaking') && level !== undefined;
  const scale = isLive ? 1 + amp * 0.035 : 1;

  const broken = status === 'error';
  const accent = broken ? 'var(--danger)' : 'var(--accent)';

  const inner = Math.round(size * (isSmall ? 0.9 : 0.78));
  const rimWidth = Math.max(1, Math.round(size * 0.006));

  return (
    <div
      role="img"
      aria-label={label ?? `MetaIoid ${status}`}
      className="relative flex select-none items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* ── Ambient field. A wide, very soft wash — the light the orb casts,
             not a glow drawn around it. ─────────────────────────────────── */}
      <motion.div
        aria-hidden
        className="absolute rounded-full"
        style={{
          width: size * 1.5,
          height: size * 1.5,
          background: `radial-gradient(closest-side, color-mix(in srgb, ${accent} 12%, transparent), transparent 72%)`,
        }}
        animate={
          isLive
            ? { opacity: 0.45 + amp * 0.55, scale: 1 + amp * 0.06 }
            : { opacity: [0.5, 0.7, 0.5], scale: [1, 1.03, 1] }
        }
        transition={
          isLive
            ? { duration: 0.16, ease: 'easeOut' }
            : { duration: s.duration || 5, repeat: Infinity, ease: 'easeInOut' }
        }
      />

      {/* ── Speaking: three soft rings leaving the surface. Deliberately slow
             and low-opacity — a ripple, not a pulse. ───────────────────── */}
      {status === 'speaking' &&
        !isSmall &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            aria-hidden
            className="absolute rounded-full"
            style={{ width: size * 0.82, height: size * 0.82, border: `1px solid ${accent}` }}
            animate={{ scale: [1, 1.5], opacity: [0.22, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.85, ease: 'easeOut' }}
          />
        ))}

      {/* ── Thinking: one hairline arc travelling the perimeter. No dot, no
             bright head — the motion carries it. ───────────────────────── */}
      {(status === 'thinking' || status === 'executing') && (
        <motion.svg
          aria-hidden
          className="absolute"
          width={size}
          height={size}
          viewBox="0 0 100 100"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
        >
          <circle
            cx="50"
            cy="50"
            r="47"
            fill="none"
            stroke={accent}
            strokeWidth="0.9"
            strokeLinecap="round"
            strokeDasharray="34 261"
            opacity="0.85"
          />
        </motion.svg>
      )}

      {/* ── The body. Concentric soft fills read as depth rather than as a
             drawn circle with a shadow. ───────────────────────────────── */}
      <motion.div
        className="relative flex items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        animate={{ scale: isLive ? scale : [1, s.breath, 1] }}
        transition={
          isLive
            ? { duration: 0.16, ease: 'easeOut' }
            : s.duration === 0
              ? { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
              : { duration: s.duration, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border"
          style={{ borderColor: `color-mix(in srgb, ${accent} ${s.rim * 100}%, var(--border))`, borderWidth: rimWidth }}
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(120% 120% at 32% 22%, color-mix(in srgb, var(--surface-elevated) 92%, transparent) 0%, var(--surface-sunken) 68%)',
          }}
        />

        {/* The lens: a single soft highlight, offset like a real light source. */}
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            width: inner * 1.28,
            height: inner * 1.28,
            background:
              'radial-gradient(closest-side, color-mix(in srgb, var(--fg) 5%, transparent), transparent 76%)',
            transform: 'translate(-16%, -20%)',
          }}
        />

        {/* Inner well — the surface the glyph sits on. */}
        <span
          aria-hidden
          className="absolute rounded-full border border-[var(--border-subtle)]"
          style={{
            width: inner,
            height: inner,
            background:
              'radial-gradient(closest-side, color-mix(in srgb, var(--fg) 2.5%, transparent), transparent 80%)',
          }}
        />

        {/* ── Content ──────────────────────────────────────────────────── */}
        <span className="relative z-10 flex items-center justify-center">
          {broken ? (
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
          ) : glyph ? (
            <svg
              width={size * (isSmall ? 0.34 : 0.24)}
              height={size * (isSmall ? 0.34 : 0.24)}
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden
            >
              <path
                d={M_GLYPH}
                stroke="var(--fg)"
                strokeWidth={isSmall ? 3.4 : 2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={status === 'idle' ? 0.55 : 0.85}
              />
            </svg>
          ) : (
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
          )}
        </span>
      </motion.div>

      {/* ── Listening: a ring that tightens as the voice gets louder, so the
             user can see the microphone is actually receiving them. ───── */}
      {status === 'listening' && !isSmall && (
        <motion.span
          aria-hidden
          className="absolute rounded-full"
          style={{ border: `1px solid ${accent}` }}
          animate={{
            width: [size, size + 16],
            height: [size, size + 16],
            opacity: level !== undefined ? 0.3 + amp * 0.5 : [0.2, 0.4, 0.2],
          }}
          transition={
            level !== undefined
              ? { duration: 0.18, ease: 'easeOut' }
              : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
          }
        />
      )}
    </div>
  );
}

/**
 * A small horizontal level meter for status rows — the only place a bar series
 * is appropriate in this product, because it reports a real measurement rather
 * than decorating a state.
 */
export function LevelBars({ level = 0, bars = 5, active = false }: { level?: number; bars?: number; active?: boolean }) {
  return (
    <span className={cn('flex h-3.5 items-end gap-[2.5px]')} aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const share = (i + 1) / bars;
        const lit = active && level >= share * 0.7;
        return (
          <span
            key={i}
            className="w-[2px] rounded-full transition-[height,background-color] duration-micro ease-out"
            style={{
              height: 4 + share * 10,
              backgroundColor: lit ? 'var(--accent)' : 'var(--border-strong)',
            }}
          />
        );
      })}
    </span>
  );
}
