// MetaIoid Unified Theme Engine.
// Curated presets: Obsidian, Graphite, Warm Paper, Nordic, OLED, System.
// Dual-theme depth: Canvas -> Surface -> Elevated -> Sunken.
// No generic indigo lock: Titanium Teal (#0ea5e9) signature accent.

import type { AppSettings, ThemeId, RadiusScale } from './types';

export interface ThemePreset {
  id: ThemeId;
  name: string;
  type: 'dark' | 'light';
  description: string;
  colors: {
    bg: string;
    bgSubtle: string;
    surface: string;
    surfaceHover: string;
    surfaceActive: string;
    surfaceElevated: string;
    surfaceSunken: string;
    border: string;
    borderSubtle: string;
    borderStrong: string;
    fg: string;
    fgSecondary: string;
    fgMuted: string;
    fgSubtle: string;
  };
}

export const THEME_PRESETS: Record<string, ThemePreset> = {
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian',
    type: 'dark',
    description: 'Deep neutral charcoal & obsidian layers',
    colors: {
      bg: '#09090b',
      bgSubtle: '#111114',
      surface: '#161619',
      surfaceHover: '#1f1f23',
      surfaceActive: '#26262b',
      surfaceElevated: '#1a1a1e',
      surfaceSunken: '#0c0c0e',
      border: 'rgba(255, 255, 255, 0.08)',
      borderSubtle: 'rgba(255, 255, 255, 0.04)',
      borderStrong: 'rgba(255, 255, 255, 0.16)',
      fg: '#f4f4f5',
      fgSecondary: '#a1a1aa',
      fgMuted: '#71717a',
      fgSubtle: '#52525b',
    },
  },
  graphite: {
    id: 'graphite',
    name: 'Graphite',
    type: 'dark',
    description: 'Cool technical slate and graphite',
    colors: {
      bg: '#0f172a',
      bgSubtle: '#141e33',
      surface: '#1e293b',
      surfaceHover: '#283548',
      surfaceActive: '#334155',
      surfaceElevated: '#243044',
      surfaceSunken: '#0b1120',
      border: 'rgba(255, 255, 255, 0.09)',
      borderSubtle: 'rgba(255, 255, 255, 0.05)',
      borderStrong: 'rgba(255, 255, 255, 0.18)',
      fg: '#f8fafc',
      fgSecondary: '#94a3b8',
      fgMuted: '#64748b',
      fgSubtle: '#475569',
    },
  },
  'warm-paper': {
    id: 'warm-paper',
    name: 'Warm Paper',
    type: 'light',
    description: 'Editorial warm ivory and soft linen',
    colors: {
      bg: '#fbfbfa',
      bgSubtle: '#f5f5f3',
      surface: '#ffffff',
      surfaceHover: '#f6f6f4',
      surfaceActive: '#ededeb',
      surfaceElevated: '#ffffff',
      surfaceSunken: '#f2f2ef',
      border: 'rgba(0, 0, 0, 0.08)',
      borderSubtle: 'rgba(0, 0, 0, 0.04)',
      borderStrong: 'rgba(0, 0, 0, 0.16)',
      fg: '#1c1917',
      fgSecondary: '#57534e',
      fgMuted: '#78716c',
      fgSubtle: '#a8a29e',
    },
  },
  nordic: {
    id: 'nordic',
    name: 'Nordic',
    type: 'light',
    description: 'Crisp minimalist cool slate and white',
    colors: {
      bg: '#f8fafc',
      bgSubtle: '#f1f5f9',
      surface: '#ffffff',
      surfaceHover: '#f1f5f9',
      surfaceActive: '#e2e8f0',
      surfaceElevated: '#ffffff',
      surfaceSunken: '#eef2f6',
      border: 'rgba(15, 23, 42, 0.09)',
      borderSubtle: 'rgba(15, 23, 42, 0.04)',
      borderStrong: 'rgba(15, 23, 42, 0.18)',
      fg: '#0f172a',
      fgSecondary: '#334155',
      fgMuted: '#64748b',
      fgSubtle: '#94a3b8',
    },
  },
  oled: {
    id: 'oled',
    name: 'OLED Pure Black',
    type: 'dark',
    description: 'True pitch black (#000000) for maximum contrast',
    colors: {
      bg: '#000000',
      bgSubtle: '#080808',
      surface: '#0d0d0e',
      surfaceHover: '#171719',
      surfaceActive: '#222225',
      surfaceElevated: '#121214',
      surfaceSunken: '#000000',
      border: 'rgba(255, 255, 255, 0.12)',
      borderSubtle: 'rgba(255, 255, 255, 0.06)',
      borderStrong: 'rgba(255, 255, 255, 0.24)',
      fg: '#ffffff',
      fgSecondary: '#a3a3a3',
      fgMuted: '#737373',
      fgSubtle: '#525252',
    },
  },
};

export const ACCENT_PALETTES = [
  { id: 'titanium', label: 'Titanium Teal', hex: '#0ea5e9' },
  { id: 'cyan', label: 'Cyan Core', hex: '#06b6d4' },
  { id: 'emerald', label: 'Subtle Emerald', hex: '#10b981' },
  { id: 'amber', label: 'Warm Amber', hex: '#f59e0b' },
  { id: 'violet', label: 'Refined Violet', hex: '#8b5cf6' },
  { id: 'rose', label: 'Calm Rose', hex: '#f43f5e' },
  { id: 'monochrome', label: 'Monochrome', hex: '#71717a' },
];

export const RADIUS_TOKENS: Record<RadiusScale, { sm: string; md: string; lg: string; xl: string }> = {
  sharp: { sm: '3px', md: '5px', lg: '8px', xl: '12px' },
  refined: { sm: '6px', md: '10px', lg: '14px', xl: '20px' },
  soft: { sm: '10px', md: '16px', lg: '22px', xl: '28px' },
};

/**
 * Resolves the active preset based on setting and system preference.
 */
export function resolvePreset(theme: ThemeId): ThemePreset {
  if (theme === 'system') {
    const isDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? THEME_PRESETS.obsidian : THEME_PRESETS.nordic;
  }
  if (theme === 'dark') return THEME_PRESETS.obsidian;
  if (theme === 'light') return THEME_PRESETS.nordic;
  return THEME_PRESETS[theme] || THEME_PRESETS.obsidian;
}

/**
 * Applies all design system CSS variables to the document root cleanly and instantly.
 */
export function applyTheme(settings: Partial<AppSettings>) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const theme = settings.theme || 'obsidian';
  const preset = resolvePreset(theme);
  const accent = settings.accent || '#0ea5e9';
  const radius = settings.radius || 'refined';
  const radTokens = RADIUS_TOKENS[radius] || RADIUS_TOKENS.refined;

  // Dark/Light class toggle
  if (preset.type === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
  }

  // Set semantic color variables
  root.style.setProperty('--bg', preset.colors.bg);
  root.style.setProperty('--bg-subtle', preset.colors.bgSubtle);
  root.style.setProperty('--surface', preset.colors.surface);
  root.style.setProperty('--surface-hover', preset.colors.surfaceHover);
  root.style.setProperty('--surface-active', preset.colors.surfaceActive);
  root.style.setProperty('--surface-elevated', preset.colors.surfaceElevated);
  root.style.setProperty('--surface-sunken', preset.colors.surfaceSunken);
  root.style.setProperty('--border', preset.colors.border);
  root.style.setProperty('--border-subtle', preset.colors.borderSubtle);
  root.style.setProperty('--border-strong', preset.colors.borderStrong);
  root.style.setProperty('--fg', preset.colors.fg);
  root.style.setProperty('--fg-secondary', preset.colors.fgSecondary);
  root.style.setProperty('--fg-muted', preset.colors.fgMuted);
  root.style.setProperty('--fg-subtle', preset.colors.fgSubtle);

  // Set accent
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-subtle', `${accent}1f`);
  root.style.setProperty('--accent-glow', `${accent}33`);

  // Set radius tokens
  root.style.setProperty('--radius-sm', radTokens.sm);
  root.style.setProperty('--radius-md', radTokens.md);
  root.style.setProperty('--radius-lg', radTokens.lg);
  root.style.setProperty('--radius-xl', radTokens.xl);

  // Density setting
  if (settings.density === 'compact') {
    root.setAttribute('data-density', 'compact');
  } else {
    root.removeAttribute('data-density');
  }

  // Animations setting
  if (settings.animations === 'reduced') {
    root.setAttribute('data-reduced-motion', 'true');
  } else {
    root.removeAttribute('data-reduced-motion');
  }
}
