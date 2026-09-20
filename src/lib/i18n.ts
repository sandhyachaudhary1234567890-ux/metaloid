export const LANGUAGES = [
  { id: 'auto', label: 'Auto Detect', short: 'AUTO', native: 'Auto' },
  { id: 'hi', label: 'Hindi', short: 'हिन्दी', native: 'हिन्दी' },
  { id: 'en', label: 'English', short: 'EN', native: 'English' },
  { id: 'hinglish', label: 'Hinglish', short: 'HING', native: 'Hinglish' },
  { id: 'es', label: 'Spanish', short: 'ES', native: 'Español' },
  { id: 'fr', label: 'French', short: 'FR', native: 'Français' },
  { id: 'de', label: 'German', short: 'DE', native: 'Deutsch' },
  { id: 'ar', label: 'Arabic', short: 'AR', native: 'العربية' },
  { id: 'ja', label: 'Japanese', short: 'JA', native: '日本語' },
  { id: 'ko', label: 'Korean', short: 'KO', native: '한국어' },
  { id: 'zh', label: 'Chinese', short: 'ZH', native: '中文' },
] as const;

export const MODELS = [
  { id: 'auto', label: 'Auto', desc: 'Picks the best demo mode', icon: '✦' },
  { id: 'fast', label: 'Fast', desc: 'Lowest latency', icon: '⚡' },
  { id: 'balanced', label: 'Balanced', desc: 'Everyday conversations', icon: '◐' },
  { id: 'smart', label: 'Smart', desc: 'Complex reasoning', icon: '⬢' },
  { id: 'vision', label: 'Vision', desc: 'Image understanding', icon: '◉' },
] as const;

export type Strings = Record<string, string>;

const en: Strings = {
  greeting_morning: 'Good morning',
  greeting_afternoon: 'Good afternoon',
  greeting_evening: 'Good evening',
  home_sub: 'What are we working on?',
  ask_anything: 'Ask me anything…',
  whats_mind: 'What’s on your mind?',
  listening: 'Listening…',
  im_listening: "I'm listening",
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  start_conv: 'Start a conversation.',
};

const hi: Strings = {
  greeting_morning: 'सुप्रभात',
  greeting_afternoon: 'नमस्ते',
  greeting_evening: 'शुभ संध्या',
  home_sub: 'आज क्या करना है?',
  ask_anything: 'कुछ भी पूछें…',
  whats_mind: 'क्या सोच रहे हैं?',
  listening: 'सुन रहा हूँ…',
  im_listening: 'मैं सुन रहा हूँ',
  thinking: 'सोच रहा हूँ…',
  speaking: 'बोल रहा हूँ…',
  start_conv: 'बातचीत शुरू करें।',
};

export function getStrings(lang: string): Strings {
  if (lang === 'hi') return hi;
  return en;
}

export function greetingFor(date = new Date(), lang = 'auto'): string {
  const h = date.getHours();
  const s = getStrings(lang === 'hi' ? 'hi' : 'en');
  if (h < 12) return s.greeting_morning;
  if (h < 17) return s.greeting_afternoon;
  return s.greeting_evening;
}

export function languageLabel(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.label ?? 'Auto Detect';
}
export function languageShort(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.short ?? 'AUTO';
}
export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? 'Balanced';
}
