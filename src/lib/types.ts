// METALOID product types — single source of truth for domain shapes.
// Primary IA only exposes capabilities that have a real runtime contract.

export type AgentStatus =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'executing'
  | 'speaking'
  | 'vision'
  | 'error';

export type LanguageId =
  | 'auto' | 'hi' | 'en' | 'hinglish'
  | 'es' | 'fr' | 'de' | 'ar' | 'ja' | 'ko' | 'zh';

export type ModelId = 'auto' | 'fast' | 'balanced' | 'smart' | 'vision';

export type ViewId =
  | 'home' | 'chat' | 'projects' | 'library' | 'research' | 'tasks'
  | 'live' | 'memory' | 'history' | 'settings' | 'auth';

export type ConnectionState = 'checking' | 'online' | 'offline';

export interface ToolActivity {
  id: string;
  tool: string;
  label: string;
  detail?: string;
  state: 'running' | 'done';
  demo?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: 'image' | 'file';
  /** thumbnail dataURL for images only (files keep metadata, no bytes) */
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  streaming?: boolean;
  toolActivity?: ToolActivity[];
  vision?: boolean;
  detectedLang?: string;
  /** previous assistant generations (regenerate history), oldest first */
  versions?: string[];
  /** which version is displayed: -1 = current content, else index into versions */
  versionIndex?: number;
  /** user thumbs feedback (visual state, local-first) */
  feedback?: 'up' | 'down';
  /** user message was edited + resent (branch changed) */
  edited?: boolean;
  /** attachments sent with a user message */
  attachments?: Attachment[];
  /** real file artifact attached to an assistant message */
  artifact?: {
    id: string;
    name: string;
    kind: string;
    status: string;
    version?: number;
    payload?: any;
  };
  /** minimal calm activity progression */
  activity?: {
    label: string;
    stages: string[];
    currentStageIndex: number;
    isComplete?: boolean;
  };
  /** generation failed — bubble shows compact error + Retry */
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  preview?: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  pinned?: boolean;
  model: ModelId;
  language: LanguageId;
}

export type MemoryCategory =
  | 'Personal' | 'Preferences' | 'Projects' | 'Important' | 'Instructions';

export interface MemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  createdAt: number;
}

export type ThemeId = 'obsidian' | 'graphite' | 'warm-paper' | 'nordic' | 'oled' | 'system' | 'dark' | 'light';
export type RadiusScale = 'sharp' | 'refined' | 'soft';

export interface AppSettings {
  theme: ThemeId;
  accent: string;
  radius: RadiusScale;
  density: 'comfortable' | 'compact';
  animations: 'full' | 'reduced';
  voiceEnabled: boolean;
  defaultLanguage: LanguageId;
  hindiVoice: string;
  englishVoice: string;
  speed: number;
  autoSpeak: boolean;
  stopOnTalk: boolean;
  agentName: string;
  personality: string;
  responseLength: 'Concise' | 'Balanced' | 'Detailed';
  creativity: 'Low' | 'Medium' | 'High';
  proactivity: 'Low' | 'Medium' | 'High';
  voiceBehavior: 'Friendly' | 'Professional' | 'Minimal' | 'Warm';
  vadSensitivity: 'Low' | 'Medium' | 'High';
  model: ModelId;
  memoryEnabled: boolean;
  showStartup: boolean;
  backendUrl: string;
}

export interface ToastItem {
  id: string;
  title: string;
  desc?: string;
  tone?: 'success' | 'error' | 'info';
}

// ---- Provider contracts (transport layer implements these) ----
// Demo transport backs them today; a real backend plugs in without UI churn.

export interface AgentProvider {
  sendMessage(message: string): Promise<string>;
  streamMessage(message: string, onToken: (t: string) => void): Promise<string>;
}

export interface VoiceProvider {
  speakText(text: string): Promise<void>;
  stopSpeaking(): void;
  getVoices(): { id: string; label: string }[];
}

export interface VisionProvider {
  analyzeImage(hint: string): Promise<string>;
}

export interface ToolProvider {
  executeTool(tool: string, input: string): Promise<string>;
}
