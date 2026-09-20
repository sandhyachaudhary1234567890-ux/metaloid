export const METAIOID_APP_NAME = 'MetaIoid';

export const VIEW_DOCUMENT_TITLES: Record<string, string> = {
  home: 'MetaIoid',
  chat: 'MetaIoid — Chat',
  live: 'MetaIoid — Vision',
  memory: 'MetaIoid — Memory',
  history: 'MetaIoid — History',
  settings: 'MetaIoid — Settings',
  voice: 'MetaIoid — Voice',
  call: 'MetaIoid — Call',
  vision: 'MetaIoid — Vision',
  research: 'MetaIoid — Research',
  world: 'MetaIoid — World',
  files: 'MetaIoid — Files',
  documents: 'MetaIoid — Files',
  'skill-forge': 'MetaIoid — Skill Forge',
  companion: 'MetaIoid — Companion',
  developer: 'MetaIoid — Developer',
};

export const BRAND_SURFACES = [
  'startup',
  'login',
  'home',
  'chat',
  'voice',
  'call',
  'vision',
  'research',
  'world',
  'files',
  'documents',
  'skill forge',
  'settings',
  'developer',
  'companion',
  'local control',
  'offline',
  'error',
  'empty',
  'loading',
  'mobile',
  'desktop',
] as const;

export function titleForView(view: string, extras?: { voiceOpen?: boolean; callOpen?: boolean }): string {
  if (extras?.callOpen) return VIEW_DOCUMENT_TITLES.call;
  if (extras?.voiceOpen) return VIEW_DOCUMENT_TITLES.voice;
  return VIEW_DOCUMENT_TITLES[view] ?? METAIOID_APP_NAME;
}
