// Realtime session adapter (§2, §23).
// Delegates to VoiceRuntime as the SINGLE SOURCE OF TRUTH.
// No competing state machines: all state transitions and concurrency tokens
// belong exclusively to VoiceRuntime.

import { VoiceRuntime } from './runtime';
import type { VoiceMachine } from './stateMachine';
import type { LatencyMarks, VoiceProfile, VoiceState, LatencyReport } from './types';
import { summarizeLatency } from './latency';

export function detectSupport() {
  const w = window as unknown as Record<string, unknown>;
  return {
    mic: !!(navigator.mediaDevices?.getUserMedia),
    stt: !!((w.SpeechRecognition as unknown) || (w.webkitSpeechRecognition as unknown)),
    tts: typeof window !== 'undefined' && 'speechSynthesis' in window,
  };
}

export interface SessionCallbacks {
  onState?: (s: VoiceState, prev: VoiceState) => void;
  onPartial?: (text: string) => void;
  onLevel?: (level: number) => void;
  onSpokenWord?: (info: { charIndex: number; text: string; phrase: string }) => void;
  onSpeaking?: (speaking: boolean, phrase: string) => void;
  onLatency?: (report: LatencyReport, marks: LatencyMarks) => void;
  onError?: (message: string) => void;
  onInterruptRequest?: () => void;
  onFinalTranscript?: (text: string, generation: number) => void;
  onPreemptiveTranscript?: (text: string) => void;
}

export class RealtimeSession {
  private runtime: VoiceRuntime;
  readonly machine: VoiceMachine;

  constructor(cb: SessionCallbacks = {}) {
    this.runtime = new VoiceRuntime({
      onState: (s, prev) => cb.onState?.(s, prev),
      onPartial: (t) => cb.onPartial?.(t),
      onLevel: (l) => cb.onLevel?.(l),
      onSpeaking: (speaking, phrase) => cb.onSpeaking?.(speaking, phrase),
      onSpokenWord: (info) => cb.onSpokenWord?.(info),
      onLatency: (report, marks) => cb.onLatency?.(report, marks),
      onError: (msg) => cb.onError?.(msg),
      onInterruptRequest: () => cb.onInterruptRequest?.(),
      onFinalTranscript: (text, gen) => cb.onFinalTranscript?.(text, gen),
      onPreemptiveTranscript: (text) => cb.onPreemptiveTranscript?.(text),
    });
    this.machine = this.runtime.machine;
  }

  get generation(): number {
    return this.runtime.generation;
  }

  setProfile(p: Partial<VoiceProfile>) {
    this.runtime.setProfile(p);
  }

  setVadThreshold(v: number | null) {
    this.runtime.setVadThreshold(v);
  }

  setMuted(m: boolean) {
    this.runtime.setMuted(m);
  }

  isMuted(): boolean {
    return this.runtime.isMuted();
  }

  supportedTTS(): boolean {
    return detectSupport().tts;
  }

  async open(lang: string): Promise<void> {
    return this.runtime.open(lang);
  }

  close() {
    this.runtime.close();
  }

  newTurn(): number {
    return this.runtime.newTurn();
  }

  feedText(generation: number, fullText: string) {
    this.runtime.feedTokens(generation, fullText);
  }

  endText(generation: number, ok = true) {
    void this.runtime.endTokens(generation, ok);
  }

  interrupt(_reason?: string) {
    this.runtime.stopSpeaking();
  }

  stopSpeaking() {
    this.runtime.stopSpeaking();
  }

  holdTalk(holding: boolean) {
    this.runtime.holdTalk(holding);
  }

  testInterim(text: string) {
    this.runtime.ingestInterim(text);
  }

  testSpeaker(): number {
    return this.runtime.testSpeaker();
  }

  exportIncidents(): string {
    return this.runtime.exportIncidents();
  }

  debug() {
    return this.runtime.debug();
  }
}
