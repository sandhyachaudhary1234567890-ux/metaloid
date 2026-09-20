// Realtime voice contracts (§34–35). Provider-agnostic; capabilities explicit.
// Real-time concurrent runtime matching Google Gemini Live Talk.

export type VoiceState =
  | 'IDLE'
  | 'LISTENING'
  | 'USER_SPEAKING'
  | 'TURN_CANDIDATE'
  | 'PROCESSING'
  | 'MODEL_SPEAKING'
  | 'USER_INTERRUPT'
  | 'CANCELLING'
  | 'RECOVERING'
  | 'ERROR';

export type SpeechChunkStatus =
  | 'BUFFERING'
  | 'READY'
  | 'SYNTHESIZING'
  | 'PLAYING'
  | 'PLAYED'
  | 'CANCELLED';

export interface SpeechChunk {
  id: string;
  text: string;
  spokenText: string;
  semanticComplete: boolean;
  grammaticalComplete: boolean;
  stable: boolean;
  confidence: number;
  estimatedDurationMs?: number;
  sourceGenerationId: number;
  turnId: string;
  status: SpeechChunkStatus;
}

export type DiagnosticSoundClass =
  | 'USER_SPEECH'
  | 'USER_SPEECH_START'
  | 'USER_SPEECH_END'
  | 'BACKGROUND_VOICE'
  | 'MUSIC'
  | 'KEYBOARD'
  | 'MOUSE'
  | 'FAN'
  | 'AC'
  | 'DOOR'
  | 'NOTIFICATION'
  | 'TV'
  | 'UNKNOWN_NOISE';

export interface SpeakerConsistency {
  isUserVoice: boolean;
  speechProb: number;
  primarySpeakerScore: number;
  echoProb: number;
  noiseFloorDb: number;
  diagnosticClass: DiagnosticSoundClass;
  confidence: number;
}

export interface VoiceTurn {
  turnId: string;
  generationId: number;
  transcript: string;
  startedAt: number;
}

export interface LatencyMarks {
  micStart?: number;
  speechStart?: number;
  speechEnd?: number;
  sttPartial?: number;
  sttFinal?: number;
  turnCandidateScore?: number;
  llmFirst?: number;
  segReady?: number;
  firstChunkReady?: number;
  ttsStart?: number;
  audioStart?: number;
  interruptDetected?: number;
  audioStopped?: number;
  turnEnd?: number;
}

export interface LatencyReport {
  ttftMs: number | null;
  ttfaMs: number | null;
  bargeInMs: number | null;
  endOfTurnMs: number | null;
  totalMs: number | null;
}

export interface VadConfig {
  threshold: number; // RMS 0..1 speech floor
  speakingThreshold?: number; // raised floor while model speaks (echo guard)
  silenceMs: number; // end-of-turn silence
  minSpeechMs: number; // ignore blips shorter than this
  interruptMs: number; // sustained energy to trigger barge-in
}

export interface SegmenterConfig {
  minLen: number;
  maxLen: number;
  softFlushMs: number;
  hardFlushMs: number;
}

export interface SpeechPlan {
  text: string;
  pauseBeforeMs: number;
  pauseAfterMs: number;
  rate: number;
  energy: number;
  emphasis: string[];
}

export interface TtsCapabilities {
  streaming: boolean;
  chunked: boolean;
  wordTimestamps: boolean;
  ssml: boolean;
  multilingual: boolean;
  cancellation: boolean;
  pauseResume: boolean;
}

export interface VoiceProfile {
  voiceId: string | null;
  lang: string;
  rate: number;
  pitch: number;
  energy: number;
}

export interface VoiceResponsePlan {
  voiceSummary: string;
  chatContent: string;
  acknowledgement?: string;
  provisionalUpdate?: string;
  hasCodeOrTable: boolean;
}

// Capability matrix — honest ledger, read by UI + docs.
export const CAPABILITIES = {
  vad: { client: 'energy-rms + spectral voice activity', server: 'none — provider STT end-of-turn as fallback', hybrid: false },
  stt: { provider: 'WebSpeech interim (Chrome/Edge)', streaming: 'interim transcripts', customVocab: false, cancel: true },
  tts: { provider: 'speechSynthesis chunked with adaptive prefetch', streaming: false, chunked: true, wordTimestamps: 'boundary events where supported', ssml: false, multilingual: 'per OS voices', cancellation: true },
  transport: { mode: 'local concurrent realtime loop', socket: 'reserved (Phase 12)' },
  bargeIn: { supported: true, via: '2-tier speech/noise + speaker consistency gate', echoGuard: 'raised threshold while speaking' },
} as const;
