import type { AppSettings, Conversation, MemoryItem } from './types';

const K = {
  settings: 'metaloid.settings.v3',
  memories: 'metaloid.memories.v2',
  conversations: 'metaloid.conversations.v2',
  activeConv: 'metaloid.activeConv.v1',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore for prototype */
  }
}

export const defaultSettings: AppSettings = {
  theme: 'obsidian',
  accent: '#0ea5e9', // Titanium Teal (replaces generic AI indigo)
  radius: 'refined',
  density: 'comfortable',
  animations: 'full',
  voiceEnabled: true,
  defaultLanguage: 'auto',
  hindiVoice: 'Swara',
  englishVoice: 'Natural English',
  speed: 1,
  autoSpeak: false,
  stopOnTalk: true,
  agentName: 'metaloid',
  personality: 'Balanced',
  responseLength: 'Balanced',
  creativity: 'Medium',
  proactivity: 'Medium',
  voiceBehavior: 'Warm',
  vadSensitivity: 'Medium',
  model: 'balanced',
  memoryEnabled: true,
  showStartup: true,
  backendUrl: 'https://127.0.0.1:8787',
};

type LegacyCategory = MemoryItem['category'] | 'Notes' | 'Language';

function migrateCategory(c: LegacyCategory): MemoryItem['category'] {
  if (c === 'Notes') return 'Personal';
  if (c === 'Language') return 'Instructions';
  return c;
}

export const defaultMemories: MemoryItem[] = [
  {
    id: 'm-1',
    content: 'You are building a private personal AI agent called metaloid.',
    category: 'Projects',
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
  },
  {
    id: 'm-2',
    content: 'Prefers concise answers for simple questions, detailed for complex ones.',
    category: 'Preferences',
    createdAt: Date.now() - 1000 * 60 * 60 * 26,
  },
  {
    id: 'm-3',
    content: 'Often uses Hindi and Hinglish. Respond in the same language style.',
    category: 'Instructions',
    createdAt: Date.now() - 1000 * 60 * 60 * 49,
  },
  {
    id: 'm-4',
    content: 'Project ZYNO AI — exploring personal assistant architecture.',
    category: 'Projects',
    createdAt: Date.now() - 1000 * 60 * 60 * 72,
  },
];

export const defaultConversations: Conversation[] = [
  {
    id: 'c-math',
    title: 'Math revision',
    preview: 'What is a derivative, intuitively?',
    createdAt: Date.now() - 1000 * 60 * 42,
    updatedAt: Date.now() - 1000 * 60 * 40,
    pinned: true,
    model: 'balanced',
    language: 'auto',
    messages: [
      { id: 'm1', role: 'user', content: 'Quick revision: what is a derivative, intuitively?', createdAt: Date.now() - 1000 * 60 * 42 },
      { id: 'm2', role: 'assistant', content: 'Think of a derivative as **instantaneous rate of change**.\n\n- Position → velocity is a derivative\n- Velocity → acceleration is a derivative\n\n> If a function is a journey, the derivative is your speedometer at each instant.', createdAt: Date.now() - 1000 * 60 * 41 },
    ],
  },
  {
    id: 'c-arch',
    title: 'AI agent architecture',
    preview: 'How should I structure a personal AI agent?',
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
    updatedAt: Date.now() - 1000 * 60 * 60 * 5,
    model: 'smart',
    language: 'en',
    messages: [
      { id: 'm1', role: 'user', content: 'How should I structure a personal AI agent?', createdAt: Date.now() - 1000 * 60 * 60 * 6 },
      { id: 'm2', role: 'assistant', content: 'A clean split works best:\n\n1. **Interface** — chat, voice, vision\n2. **Reasoning** — model + tools\n3. **Memory** — durable personal context\n4. **Actions** — tools with clear permissions\n\nKeep memory local-first and every tool call visible.', createdAt: Date.now() - 1000 * 60 * 60 * 6 + 60000 },
    ],
  },
];

export const storage = {
  loadSettings(): AppSettings {
    // merge over defaults so new keys (memoryEnabled, showStartup, backendUrl, radius) land safely
    const legacy = read<Partial<AppSettings>>(K.settings, {});
    const v1 = read<Partial<AppSettings>>('metaloid.settings.v1', {});
    const merged: AppSettings = { ...defaultSettings, ...v1, ...legacy };

    // Migrate generic indigo default to titanium teal
    if (merged.accent === '#6366f1') {
      merged.accent = '#0ea5e9';
    }
    // Migrate legacy 'dark' / 'light' to curated presets if needed
    if (merged.theme === 'dark') {
      merged.theme = 'obsidian';
    } else if (merged.theme === 'light') {
      merged.theme = 'nordic';
    }
    if (!merged.radius) {
      merged.radius = 'refined';
    }

    return merged;
  },
  saveSettings(s: AppSettings) {
    write(K.settings, s);
  },
  loadMemories(): MemoryItem[] {
    const m = read<(MemoryItem & { category: LegacyCategory })[] | null>(K.memories, null);
    if (m) return m.map((x) => ({ ...x, category: migrateCategory(x.category) }));
    const v1 = read<(MemoryItem & { category: LegacyCategory })[] | null>('metaloid.memories.v1', null);
    if (v1) {
      const migrated = v1.map((x) => ({ ...x, category: migrateCategory(x.category) }));
      write(K.memories, migrated);
      return migrated;
    }
    write(K.memories, defaultMemories);
    return defaultMemories;
  },
  saveMemories(m: MemoryItem[]) {
    write(K.memories, m);
  },
  loadConversations(): Conversation[] {
    const c = read<Conversation[] | null>(K.conversations, null);
    if (c) return c.map((x) => ({ ...x, preview: x.preview ?? x.messages.find((mm) => mm.role === 'user')?.content.slice(0, 90) }));
    const v1 = read<Conversation[] | null>('metaloid.conversations.v1', null);
    if (v1) {
      const mapped = v1.map((x) => ({ ...x, preview: x.messages.find((mm) => mm.role === 'user')?.content.slice(0, 90) }));
      write(K.conversations, mapped);
      return mapped;
    }
    write(K.conversations, defaultConversations);
    return defaultConversations;
  },
  saveConversations(c: Conversation[]) {
    write(K.conversations, c);
  },
  loadActiveConv(): string | null {
    return read<string | null>(K.activeConv, null);
  },
  saveActiveConv(id: string | null) {
    if (id) write(K.activeConv, id);
    else localStorage.removeItem(K.activeConv);
  },
  clearAll() {
    Object.values(K).forEach((k) => localStorage.removeItem(k));
  },
};

export function saveMemory(item: MemoryItem) {
  const all = storage.loadMemories();
  storage.saveMemories([item, ...all]);
}
export function loadMemories() {
  return storage.loadMemories();
}
export function saveConversation(conv: Conversation) {
  const all = storage.loadConversations();
  const i = all.findIndex((c) => c.id === conv.id);
  if (i >= 0) all[i] = conv;
  else all.unshift(conv);
  storage.saveConversations(all);
}
export function loadConversations() {
  return storage.loadConversations();
}
export function saveSettings(s: AppSettings) {
  storage.saveSettings(s);
}
export function loadSettings() {
  return storage.loadSettings();
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
