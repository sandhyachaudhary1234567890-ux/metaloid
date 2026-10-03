/**
 * MetaIoid Design System — canonical tokens.
 *
 * One source of truth. Everything visual (CSS variables, Tailwind theme,
 * framer-motion timings) derives from the values declared here so the product
 * cannot drift into six unrelated palettes again.
 *
 * ── Art direction ──────────────────────────────────────────────────────────
 * Mood            quiet intelligence
 * Composition     minimal, generous negative space, one idea per screen
 * Lighting        soft, controlled, directional — never neon
 * Palette         warm neutral greys + a single jade accent
 * Geometry        clean, precise, small radii — no blobs, no glass
 *
 * ── Rules ──────────────────────────────────────────────────────────────────
 * · Never pure black, never pure white as a page background.
 * · The accent is a signal, not a theme. It marks one thing per screen.
 * · Depth comes from surface value + hairline borders, not from big shadows.
 * · Text sizes come from `type` — there are no one-off font sizes.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   COLOR
   ───────────────────────────────────────────────────────────────────────────── */

/** Every neutral ramp has the same construction so themes feel like siblings. */
export interface NeutralRamp {
  bg: string
  bgSubtle: string
  surface: string
  surfaceHover: string
  surfaceActive: string
  surfaceElevated: string
  surfaceSunken: string
  border: string
  borderSubtle: string
  borderStrong: string
  fg: string
  fgSecondary: string
  fgMuted: string
  fgSubtle: string
  /** Was referenced 23× across the app but never defined — it inherits today. */
  fgFaint: string
}

/**
 * Warm Obsidian — the default. Warm near-black so it reads as ink and paper
 * rather than as a switched-off screen. Elevation climbs in warmth, never in
 * brightness alone.
 */
export const OBSIDIAN: NeutralRamp = {
  bg: '#0E0E0D',
  bgSubtle: '#141413',
  surface: '#171716',
  surfaceHover: '#1F1F1C',
  surfaceActive: '#272723',
  surfaceElevated: '#1B1B1A',
  surfaceSunken: '#0A0A09',
  border: 'rgba(244, 240, 232, 0.085)',
  borderSubtle: 'rgba(244, 240, 232, 0.045)',
  borderStrong: 'rgba(244, 240, 232, 0.16)',
  fg: '#F2EFE8',
  fgSecondary: '#ABA69B',
  fgMuted: '#7E796F',
  fgSubtle: '#5C5850',
  fgFaint: '#403D37',
}

/** Graphite — the cool sibling. Same construction, slate cast. */
export const GRAPHITE: NeutralRamp = {
  bg: '#0D0F12',
  bgSubtle: '#12151A',
  surface: '#161A1F',
  surfaceHover: '#1E232A',
  surfaceActive: '#262C34',
  surfaceElevated: '#1A1E24',
  surfaceSunken: '#090B0E',
  border: 'rgba(226, 232, 240, 0.09)',
  borderSubtle: 'rgba(226, 232, 240, 0.05)',
  borderStrong: 'rgba(226, 232, 240, 0.17)',
  fg: '#EEF1F5',
  fgSecondary: '#A5AEB9',
  fgMuted: '#79828D',
  fgSubtle: '#575F68',
  fgFaint: '#3C434A',
}

/** OLED — deepest step of Obsidian, for people who want the screen to vanish. */
export const OLED: NeutralRamp = {
  bg: '#000000',
  bgSubtle: '#070706',
  surface: '#0B0B0A',
  surfaceHover: '#141413',
  surfaceActive: '#1C1C1A',
  surfaceElevated: '#0F0F0E',
  surfaceSunken: '#000000',
  border: 'rgba(244, 240, 232, 0.11)',
  borderSubtle: 'rgba(244, 240, 232, 0.055)',
  borderStrong: 'rgba(244, 240, 232, 0.20)',
  fg: '#F5F3EE',
  fgSecondary: '#A8A398',
  fgMuted: '#797469',
  fgSubtle: '#55514A',
  fgFaint: '#3A3733',
}

/**
 * Warm Paper — the light default. Deliberately designed as light, not as
 * inverted dark: warm ivory page, true-white raised surfaces, ink text.
 */
export const WARM_PAPER: NeutralRamp = {
  bg: '#FAF8F4',
  bgSubtle: '#F3EFE7',
  surface: '#FFFFFF',
  surfaceHover: '#F6F2EA',
  surfaceActive: '#EDE7DB',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#F1ECE2',
  border: 'rgba(38, 32, 22, 0.085)',
  borderSubtle: 'rgba(38, 32, 22, 0.045)',
  borderStrong: 'rgba(38, 32, 22, 0.16)',
  fg: '#1A1815',
  fgSecondary: '#4A453B',
  fgMuted: '#766F63',
  fgSubtle: '#9B948A',
  fgFaint: '#C4BDB2',
}

/** Nordic — the cool light sibling. Crisp, editorial, still warm-shadowed. */
export const NORDIC: NeutralRamp = {
  bg: '#F8F9FB',
  bgSubtle: '#F1F3F6',
  surface: '#FFFFFF',
  surfaceHover: '#F3F5F8',
  surfaceActive: '#E8EBF0',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#EEF1F5',
  border: 'rgba(18, 24, 33, 0.09)',
  borderSubtle: 'rgba(18, 24, 33, 0.045)',
  borderStrong: 'rgba(18, 24, 33, 0.17)',
  fg: '#12161C',
  fgSecondary: '#40474F',
  fgMuted: '#6B727B',
  fgSubtle: '#98A0A8',
  fgFaint: '#C2C8CE',
}

/* ─────────────────────────────────────────────────────────────────────────────
   ACCENT — MetaIoid Jade
   ─────────────────────────────────────────────────────────────────────────────

   The accent carries two jobs that need opposite values, which is why the old
   single `--accent` was either unreadable as text or unreadable as a button
   fill. They are now separate tokens:

     --accent        luminous.  for text, icons, indicators, focus rings.
     --accent-solid  deep.      for fills that carry white text.
*/
export interface AccentSet {
  /** Luminous — safe as text on the mode's background. */
  accent: string
  /** Deep — safe as a fill under white text. */
  solid: string
  /** Text colour that sits on `solid`. */
  onSolid: string
  /** 8–14% wash for selected rows and quiet highlights. */
  subtle: string
  /** Soft halo behind focused inputs and active indicators. */
  ring: string
}

export const JADE_DARK: AccentSet = {
  accent: '#5CC79A',
  solid: '#146B4E',
  onSolid: '#F2FFF9',
  subtle: 'rgba(92, 199, 154, 0.12)',
  ring: 'rgba(92, 199, 154, 0.38)',
}

export const JADE_LIGHT: AccentSet = {
  accent: '#0B6E52',
  solid: '#0B6E52',
  onSolid: '#FFFFFF',
  subtle: 'rgba(11, 110, 82, 0.08)',
  ring: 'rgba(11, 110, 82, 0.30)',
}

/** The accent choices offered in Settings. All are pre-split into both jobs. */
export interface AccentChoice {
  id: string
  label: string
  dark: AccentSet
  light: AccentSet
}

const mk = (id: string, label: string, dark: string, solidDark: string, light: string, solidLight: string): AccentChoice => ({
  id,
  label,
  dark: { accent: dark, solid: solidDark, onSolid: '#FFFFFF', subtle: hexA(dark, 0.12), ring: hexA(dark, 0.38) },
  light: { accent: light, solid: solidLight, onSolid: '#FFFFFF', subtle: hexA(light, 0.08), ring: hexA(light, 0.3) },
})

/** `#RRGGBB` + alpha → `rgba(...)`, so token files stay readable. */
export function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export const ACCENTS: AccentChoice[] = [
  mk('jade', 'Jade', '#5CC79A', '#146B4E', '#0B6E52', '#0B6E52'),
  mk('verdigris', 'Verdigris', '#6FC7B8', '#10685F', '#0A6157', '#0A6157'),
  mk('amber', 'Amber', '#D9A441', '#8A5F14', '#8A5F14', '#8A5F14'),
  mk('indigo', 'Indigo', '#8E9BF0', '#3B45A8', '#3B45A8', '#3B45A8'),
  mk('clay', 'Clay', '#D08A6E', '#8A4630', '#8A4630', '#8A4630'),
  mk('graphite', 'Graphite', '#A6A399', '#4A4841', '#4A4841', '#4A4841'),
]

export const DEFAULT_ACCENT = 'jade'

/* ─────────────────────────────────────────────────────────────────────────────
   TYPE
   ─────────────────────────────────────────────────────────────────────────────

   Nine steps replace the twenty-three arbitrary pixel sizes the app had
   accumulated. Each step names its job, not its size, so the choice is obvious.

     hero     welcome headline — one per product
     display  section headline
     heading  card / panel title
     title    sub-heading, dialog title
     read     long-form assistant prose
     body     default UI text
     ui       dense controls, list rows
     small    metadata, captions
     micro    uppercase labels with tracking
*/
export const type = {
  hero: { size: '38px', lineHeight: '44px', tracking: '-0.028em', weight: 600 },
  display: { size: '26px', lineHeight: '32px', tracking: '-0.022em', weight: 600 },
  heading: { size: '21px', lineHeight: '28px', tracking: '-0.018em', weight: 600 },
  title: { size: '17px', lineHeight: '24px', tracking: '-0.012em', weight: 600 },
  read: { size: '15.5px', lineHeight: '26px', tracking: '-0.004em', weight: 400 },
  body: { size: '14.5px', lineHeight: '22px', tracking: '-0.002em', weight: 400 },
  ui: { size: '13.5px', lineHeight: '19px', tracking: '0em', weight: 400 },
  small: { size: '12.5px', lineHeight: '17px', tracking: '0.002em', weight: 400 },
  micro: { size: '11.5px', lineHeight: '16px', tracking: '0.09em', weight: 600 },
} as const

export type TypeStep = keyof typeof type

/* ─────────────────────────────────────────────────────────────────────────────
   SPACE — an 8px rhythm with a 4px half-step for optical alignment only.
   ───────────────────────────────────────────────────────────────────────────── */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const

/* ─────────────────────────────────────────────────────────────────────────────
   RADIUS — five values. Anything needing a sixth is a composition error.
   ───────────────────────────────────────────────────────────────────────────── */
export const radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const

/** Radius scales offered in Settings, applied as CSS variables. */
export const RADIUS_SCALES = {
  sharp: { sm: '4px', md: '7px', lg: '10px', xl: '14px' },
  refined: { sm: '8px', md: '12px', lg: '16px', xl: '22px' },
  soft: { sm: '10px', md: '16px', lg: '22px', xl: '28px' },
} as const

/* ─────────────────────────────────────────────────────────────────────────────
   ELEVATION — depth is warm-tinted and shallow. Four steps, no more.
   ───────────────────────────────────────────────────────────────────────────── */
export const elevation = {
  none: 'none',
  /** Resting interactive surface: a raised card that is not floating. */
  raised: '0 1px 2px -1px rgba(0,0,0,0.20), 0 1px 3px -1px rgba(0,0,0,0.10)',
  /** Composers, popovers, dropdown menus. */
  pop: '0 8px 28px -10px rgba(0,0,0,0.34), 0 2px 8px -3px rgba(0,0,0,0.22)',
  /** Dialogs and sheets — the only place a large blur is allowed. */
  dialog: '0 32px 72px -24px rgba(0,0,0,0.46), 0 8px 24px -10px rgba(0,0,0,0.30)',
} as const

/* ─────────────────────────────────────────────────────────────────────────────
   LAYOUT — reading widths are chosen, not inherited from a grid.
   ───────────────────────────────────────────────────────────────────────────── */
export const layout = {
  /** Conversation column. ~72ch of assistant prose — a book measure. */
  chat: 720,
  /** Upper bound for full-bleed page content. */
  page: 1240,
  /** Sidebar expanded / collapsed. */
  sidebar: 248,
  sidebarRail: 64,
  /** Welcome composition. Narrower than chat so the headline leads. */
  welcome: 640,
} as const

/* ─────────────────────────────────────────────────────────────────────────────
   Z-INDEX — named, so stacking is auditionable rather than guessed.
   ───────────────────────────────────────────────────────────────────────────── */
export const z = {
  base: 0,
  sticky: 20,
  nav: 30,
  scrim: 40,
  overlay: 50,
  boot: 60,
  modal: 70,
  toast: 80,
} as const
