/**
 * MetaIoid Motion System.
 *
 * Four scales. Every animation in the product picks one of them — there are no
 * ad-hoc durations or easings, because inconsistency is what makes motion feel
 * amateur even when each individual animation is fine.
 *
 * ── The motion language ────────────────────────────────────────────────────
 *   BOOT      soft reveal — the product fades up, it does not slide in
 *   CHAT      calm content arrival — 6px of travel, never more
 *   SEND      precise transition — short, mechanical, no bounce
 *   VOICE     organic pulse — the only motion allowed to breathe
 *   TOOLS     subtle activity — quiet loops that read as "alive"
 *   SUCCESS   quiet confirmation — a settle, not a celebration
 *   ERROR     restrained interruption — a short horizontal shake
 *
 * ── Never ──────────────────────────────────────────────────────────────────
 *   · spring bounce on anything the user did not directly grab
 *   · animations longer than 500ms on a primary interaction
 *   · opacity-only fades for content the user is waiting on
 */

export const duration = {
  /** Hover, press, focus ring, icon swap. Under the perception threshold. */
  micro: 0.12,
  /** Menus, tooltips, chips, small state flips. */
  small: 0.18,
  /** Panels, page cross-fades, message arrival. */
  medium: 0.26,
  /** Boot, welcome entrance, voice overlay. Reserved for moments. */
  large: 0.42,
} as const

export const ease = {
  /** Default for anything entering. Fast out of the gate, settles softly. */
  out: [0.22, 1, 0.36, 1] as const,
  /** Symmetric — for state flips between two resting values. */
  inOut: [0.65, 0, 0.35, 1] as const,
  /** Leaving the screen. Slightly quicker than `out`. */
  exit: [0.4, 0, 1, 1] as const,
  /** Mechanical and precise. SEND, and anything tool-related. */
  precise: [0.16, 1, 0.3, 1] as const,
} as const

export const scale = {
  micro: { duration: duration.micro, ease: ease.out },
  small: { duration: duration.small, ease: ease.out },
  medium: { duration: duration.medium, ease: ease.out },
  large: { duration: duration.large, ease: ease.out },
  exit: { duration: duration.small, ease: ease.exit },
  precise: { duration: duration.micro, ease: ease.precise },
} as const

/* ─────────────────────────────────────────────────────────────────────────────
   VARIANTS — the actual vocabulary. Compose these instead of inline objects.
   ───────────────────────────────────────────────────────────────────────────── */

/** Content arriving in place. 6px of travel: enough to read as motion, not
 *  enough to move the user's eye off the text they are about to read. */
export const rise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: duration.medium, ease: ease.out },
}

/** The same arrival, softer — used for whole panels and pages. */
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: duration.medium, ease: ease.out },
}

/** Menus and popovers. Grows from the corner it is anchored to. */
export const pop = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -2, scale: 0.99 },
  transition: { duration: duration.small, ease: ease.out },
}

/** Dialogs. The only place a scale this large is allowed. */
export const dialog = {
  initial: { opacity: 0, scale: 0.98, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.99, y: 4 },
  transition: { duration: duration.medium, ease: ease.out },
}

/** Bottom sheets on mobile. */
export const sheet = {
  initial: { y: '100%' },
  animate: { y: 0 },
  exit: { y: '100%' },
  transition: { duration: duration.medium, ease: ease.out },
}

/** A message joining the conversation. Slightly tighter than `rise`. */
export const message = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: duration.small, ease: ease.out },
}

/** Tool activity resolving into its result. Fades up and out of the way. */
export const resolve = {
  initial: { opacity: 1, y: 0, height: 'auto' },
  exit: { opacity: 0, y: -4, transition: { duration: duration.small, ease: ease.exit } },
}

/**
 * Restrained interruption for errors — one short, small horizontal
 * displacement. Deliberately not a cartoon shake.
 */
export const shake = {
  animate: { x: [0, -4, 4, -2, 0] },
  transition: { duration: 0.24, ease: ease.inOut },
}

/** Quiet confirmation. A single settle; no scale-up pop, no confetti. */
export const settle = {
  initial: { scale: 1 },
  animate: { scale: [1, 1.03, 1] },
  transition: { duration: 0.34, ease: ease.out },
}

/* ─────────────────────────────────────────────────────────────────────────────
   LOOPS — the small number of animations allowed to run indefinitely.
   Every one of them must be pausable when off-screen or when the user has
   asked for reduced motion.
   ───────────────────────────────────────────────────────────────────────────── */

/** Ambient breath for the voice orb's resting state. */
export const breathe = {
  animate: { scale: [1, 1.015, 1], opacity: [0.92, 1, 0.92] },
  transition: { duration: 4.4, ease: 'easeInOut', repeat: Infinity },
}

/** Active work. Three dots, staggered — reads as thinking, not as loading. */
export const thinking = {
  animate: { opacity: [0.25, 1, 0.25] },
  transition: { duration: 1.1, ease: 'easeInOut', repeat: Infinity },
}

/* ─────────────────────────────────────────────────────────────────────────────
   CSS MIRROR
   Kept in sync with index.css so JS-driven and CSS-driven motion cannot drift.
   ───────────────────────────────────────────────────────────────────────────── */
export const cssEase = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  precise: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const

export const cssDuration = {
  micro: '120ms',
  small: '180ms',
  medium: '260ms',
  large: '420ms',
} as const
