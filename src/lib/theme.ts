/**
 * MetaIoid Theme Engine.
 *
 * A thin adapter: it resolves a user's setting into one of the design
 * system's modes and writes the CSS variables from `src/design/tokens.ts`.
 * It no longer owns any colour of its own — that is what let five unrelated
 * palettes and a stray sky-blue accent drift into the product.
 *
 * Presets are now siblings of one construction (warm/cool × dark/light), so
 * switching theme changes the mood without changing the product's identity.
 */

import type { AppSettings, ThemeId, RadiusScale } from './types';
import {
  OBSIDIAN,
  GRAPHITE,
  OLED,
  WARM_PAPER,
  NORDIC,
  ACCENTS,
  DEFAULT_ACCENT,
  RADIUS_SCALES,
  type NeutralRamp,
  type AccentSet,
} from '../design/tokens';

export interface ThemePreset {
  id: ThemeId;
  name: string;
  type: 'dark' | 'light';
  description: string;
  colors: NeutralRamp;
}

/** `NeutralRamp` keys are camelCase; the CSS variables are kebab-case. */
const VAR_NAME: Record<keyof NeutralRamp, string> = {
  bg: '--bg',
  bgSubtle: '--bg-subtle',
  surface: '--surface',
  surfaceHover: '--surface-hover',
  surfaceActive: '--surface-active',
  surfaceElevated: '--surface-elevated',
  surfaceSunken: '--surface-sunken',
  border: '--border',
  borderSubtle: '--border-subtle',
  borderStrong: '--border-strong',
  fg: '--fg',
  fgSecondary: '--fg-secondary',
  fgMuted: '--fg-muted',
  fgSubtle: '--fg-subtle',
  fgFaint: '--fg-faint',
};

export const THEME_PRESETS: Record<string, ThemePreset> = {
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian',
    type: 'dark',
    description: 'Warm near-black, ink and bone',
    colors: OBSIDIAN,
  },
  graphite: {
    id: 'graphite',
    name: 'Graphite',
    type: 'dark',
    description: 'Cool slate, technical and calm',
    colors: GRAPHITE,
  },
  oled: {
    id: 'oled',
    name: 'Deep Black',
    type: 'dark',
    description: 'Maximum depth for OLED displays',
    colors: OLED,
  },
  'warm-paper': {
    id: 'warm-paper',
    name: 'Warm Paper',
    type: 'light',
    description: 'Ivory page, true-white raised surfaces',
    colors: WARM_PAPER,
  },
  nordic: {
    id: 'nordic',
    name: 'Daylight',
    type: 'light',
    description: 'Crisp, cool and editorial',
    colors: NORDIC,
  },
};

/** Swatches for Settings. `swatch` is chosen to read correctly in both modes. */
export const ACCENT_PALETTES = ACCENTS.map((a) => ({
  id: a.id,
  label: a.label,
  hex: a.dark.accent,
  hexLight: a.light.accent,
  swatch: a.dark.accent,
}));

export const RADIUS_TOKENS: Record<RadiusScale, { sm: string; md: string; lg: string; xl: string }> = RADIUS_SCALES;

/**
 * Resolves the active preset. `system`, `dark` and `light` are aliases kept
 * for settings written by older builds.
 */
export function resolvePreset(theme: ThemeId): ThemePreset {
  if (theme === 'system') {
    const isDark =
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? THEME_PRESETS.obsidian : THEME_PRESETS.nordic;
  }
  if (theme === 'dark') return THEME_PRESETS.obsidian;
  if (theme === 'light') return THEME_PRESETS.nordic;
  return THEME_PRESETS[theme] || THEME_PRESETS.obsidian;
}

/**
 * Resolves the accent. Accepts either a palette id (`'jade'`) or a raw hex,
 * so settings saved before the accent was split still resolve to the right,
 * legible pair instead of a luminous fill with white text on it.
 */
export function resolveAccent(value: string | undefined, mode: 'dark' | 'light'): AccentSet {
  const wanted = value || DEFAULT_ACCENT;

  const byId = ACCENTS.find((a) => a.id === wanted);
  if (byId) return mode === 'dark' ? byId.dark : byId.light;

  if (/^#[0-9a-f]{3,8}$/i.test(wanted)) {
    const byHex = ACCENTS.find(
      (a) => a.dark.accent.toLowerCase() === wanted.toLowerCase() || a.light.accent.toLowerCase() === wanted.toLowerCase(),
    );
    if (byHex) return mode === 'dark' ? byHex.dark : byHex.light;
  }

  return mode === 'dark' ? ACCENTS[0].dark : ACCENTS[0].light;
}

/** Applies the whole design token layer to the document root. */
export function applyTheme(settings: Partial<AppSettings>) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const preset = resolvePreset(settings.theme || 'obsidian');
  const mode = preset.type;
  const accent = resolveAccent(settings.accent, mode);
  const rad = RADIUS_TOKENS[(settings.radius as RadiusScale)] || RADIUS_TOKENS.refined;

  // ── Mode class. Both directions are set so nothing can be half-applied.
  if (mode === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
  }

  // ── Neutral ramp
  for (const [key, value] of Object.entries(preset.colors)) {
    root.style.setProperty(VAR_NAME[key as keyof NeutralRamp], value);
  }

  // ── Accent, split into its two jobs. The channel triplet is what makes
  //    `bg-accent/10` track the user's chosen accent instead of the default.
  root.style.setProperty('--accent-rgb', channels(accent.accent));
  root.style.setProperty('--accent-solid-rgb', channels(accent.solid));
  root.style.setProperty('--accent', accent.accent);
  root.style.setProperty('--accent-solid', accent.solid);
  root.style.setProperty('--accent-on-solid', accent.onSolid);
  root.style.setProperty('--accent-subtle', accent.subtle);
  root.style.setProperty('--accent-ring', accent.ring);
  root.style.setProperty('--accent-glow', accent.subtle);

  // ── Radius
  root.style.setProperty('--radius-sm', rad.sm);
  root.style.setProperty('--radius-md', rad.md);
  root.style.setProperty('--radius-lg', rad.lg);
  root.style.setProperty('--radius-xl', rad.xl);

  // ── Density
  if (settings.density === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');

  // ── Motion. The in-app "reduced" toggle sits alongside the OS preference;
  //    index.css collapses both to nothing.
  if (settings.animations === 'reduced') root.setAttribute('data-reduced-motion', 'true');
  else root.removeAttribute('data-reduced-motion');
}

/**
 * `#RRGGBB` → `"R G B"`, the channel form Tailwind needs for `<alpha-value>`.
 * Falls back to the default accent's channels if the value is not parseable,
 * so a malformed setting can never blank out every accent-tinted surface.
 */
function channels(hex: string): string {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return '92 199 154';
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Applies the theme and keeps it in sync with the OS while `system` is set. */
export function watchTheme(settings: Partial<AppSettings>): () => void {
  if (typeof window === 'undefined') return () => {};
  applyTheme(settings);
  if (settings.theme !== 'system') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme(settings);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
