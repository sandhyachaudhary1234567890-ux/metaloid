/**
 * Tailwind theme — mirrors src/design/tokens.ts.
 *
 * The theme is intentionally thin: it exposes the design system's vocabulary
 * (semantic colours, the nine-step type scale, the motion durations) and
 * nothing else. If a value is not here, it is not part of the product.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
        display: ['Manrope', 'Inter', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      /* The nine-step type scale. Line-heights are attached so text has a
         rhythm even where a component forgets to set leading; an explicit
         `leading-*` utility still wins, which keeps existing layouts safe. */
      fontSize: {
        micro: ['11.5px', { lineHeight: '16px' }],
        small: ['12.5px', { lineHeight: '17px' }],
        ui: ['13.5px', { lineHeight: '19px' }],
        body: ['14.5px', { lineHeight: '22px' }],
        read: ['15.5px', { lineHeight: '26px' }],
        title: ['17px', { lineHeight: '24px' }],
        heading: ['21px', { lineHeight: '28px' }],
        display: ['26px', { lineHeight: '32px' }],
        hero: ['38px', { lineHeight: '44px' }],
      },

      colors: {
        /* Semantic surfaces */
        bg: 'var(--bg)',
        'bg-subtle': 'var(--bg-subtle)',
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        'surface-active': 'var(--surface-active)',
        'surface-elevated': 'var(--surface-elevated)',
        'surface-sunken': 'var(--surface-sunken)',

        /* Semantic borders */
        border: 'var(--border)',
        'border-subtle': 'var(--border-subtle)',
        'border-strong': 'var(--border-strong)',

        /* Semantic text */
        fg: 'var(--fg)',
        'fg-secondary': 'var(--fg-secondary)',
        'fg-muted': 'var(--fg-muted)',
        'fg-subtle': 'var(--fg-subtle)',
        'fg-faint': 'var(--fg-faint)',

        /* Accent, split by job */
        accent: 'var(--accent)',
        'accent-solid': 'var(--accent-solid)',
        'accent-on-solid': 'var(--accent-on-solid)',
        'accent-subtle': 'var(--accent-subtle)',
        'accent-ring': 'var(--accent-ring)',

        /* Status. Channel form so `bg-success/10` and `border-danger/30`
           work — a translucent second hex per state is how palettes drift. */
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
        warning: 'rgb(var(--warning-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        info: 'rgb(var(--info-rgb) / <alpha-value>)',
        'accent-rgb': 'rgb(var(--accent-rgb) / <alpha-value>)',
      },

      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        'theme-sm': 'var(--radius-sm)',
        'theme-md': 'var(--radius-md)',
        'theme-lg': 'var(--radius-lg)',
        'theme-xl': 'var(--radius-xl)',
      },

      boxShadow: {
        raised: 'var(--shadow-raised)',
        pop: 'var(--shadow-pop)',
        dialog: 'var(--shadow-dialog)',
        /* legacy aliases */
        elevated: 'var(--shadow-raised)',
        card: 'var(--shadow-raised)',
      },

      maxWidth: {
        chat: '720px',
        welcome: '640px',
        prose: '68ch',
      },

      transitionDuration: {
        micro: '120ms',
        small: '180ms',
        medium: '260ms',
        large: '420ms',
      },

      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
        inout: 'cubic-bezier(0.65, 0, 0.35, 1)',
        precise: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      keyframes: {
        breathe: {
          '0%,100%': { transform: 'scale(1)', opacity: '0.92' },
          '50%': { transform: 'scale(1.015)', opacity: '1' },
        },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },

      animation: {
        breathe: 'breathe 4.4s cubic-bezier(0.65,0,0.35,1) infinite',
        'fade-in': 'fadeIn 260ms cubic-bezier(0.22,1,0.36,1) both',
        'rise-in': 'riseIn 260ms cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
}
