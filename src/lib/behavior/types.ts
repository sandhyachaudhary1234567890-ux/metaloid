// Human Behavior & Social Intelligence Layer Types (§33)
// Models natural human conversational dynamics without feigning human life, memories, or consciousness.

export type EmotionalToneCue =
  | 'casual'
  | 'technical'
  | 'serious'
  | 'frustrated'
  | 'excited'
  | 'confused'
  | 'playful';

export type RepairCategory =
  | 'MISUNDERSTANDING'
  | 'AMBIGUITY_CLARIFICATION'
  | 'CORRECTION_ACKNOWLEDGED'
  | 'UNCERTAINTY_DISCLOSED'
  | 'HEARING_FRAGMENT';

export interface RepairDirective {
  needed: boolean;
  category?: RepairCategory;
  prefix?: string;
  clarificationQuestion?: string;
}

export interface ConversationState {
  currentTopic: string;
  currentGoal: string;
  currentTask: string;
  recentReferences: string[]; // e.g. "that UI", "yesterday's work", "same as before"
  unfinishedThoughts: string[];
  userCorrections: string[];
  activeEmotionCue: EmotionalToneCue;
  activeTool?: string;
  activeBackgroundTask?: string;
  lastTurnAt: number;
}

export interface BehavioralTuning {
  tone: EmotionalToneCue;
  verbosity: 'concise' | 'balanced' | 'deep';
  pacingMs: number; // Natural pause timing
  progressiveDisclosure: boolean; // Lead with immediate core answer
  allowLightHumor: boolean;
  backchannelWord?: string; // "Got it", "Right", "Okay", used sparingly
  acknowledgedCorrection?: string;
  calibratedUncertaintyPrefix?: string;
}

export interface FormattedBehavioralResponse {
  spokenText: string; // Tailored for voice delivery without markdown clutter
  displayText: string; // Full markdown with progressive disclosure
  detectedLang: 'English' | 'Hindi' | 'Hinglish';
  tuning: BehavioralTuning;
  repair?: RepairDirective;
}
