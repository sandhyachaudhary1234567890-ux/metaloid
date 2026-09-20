// METALOID design tokens — one system, no arbitrary values in components.
// Color logic: CYAN = AI · VIOLET = voice · BLUE = vision · PURPLE = memory
// WHITE = system · GREEN = success · AMBER = warning · RED = error.

export const color = {
  graphite950: '#08090b',
  graphite900: '#0c0d10',
  graphite850: '#111318',
  graphite800: '#16181e',
  graphite750: '#1b1e26',
  pearl: '#eef2f7',
  ice: '#cfe6ff',
  cyan: '#7ef0e2', // AI
  violet: '#a78bfa', // voice
  blue: '#60a5fa', // vision
  purple: '#c084fc', // memory
  success: '#34d399',
  warning: '#fbbf24',
  error: '#f87171',
} as const;

export const stateColor: Record<string, string> = {
  idle: color.pearl,
  listening: color.violet,
  thinking: color.cyan,
  executing: color.cyan,
  speaking: color.violet,
  vision: color.blue,
  error: color.error,
};

export const radius = { sm: 12, md: 16, lg: 24, pill: 999 } as const;

/** 8px rhythm — spacing scale index = n * 8 */
export const space = (n: number) => n * 8;

export const motion = {
  fast: 180, // 150–220ms micro-interactions
  standard: 300, // 250–350ms standard
  major: 550, // 400–700ms major transitions
  ease: [0.22, 1, 0.36, 1] as const,
} as const;

export const layout = {
  maxContent: 1200,
  homeCenter: 860,
  chatColumn: 760,
  radiusSidebar: 264,
} as const;
