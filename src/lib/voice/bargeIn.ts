// Barge-in & Interruption Controller.
// Operates on the 2-tier architecture:
// Audio -> Speech/Noise -> Speaker-consistency gate -> Likely user (BARGE-IN) vs Likely background (IGNORE).
// Measures real-world latency: interruptDetected -> audioStopped (optimizing p95 < 100ms, best-case < 50ms).

import type { SpeakerGateResult } from './backgroundClassifier';

const INTERRUPT_KEYWORDS = new Set([
  'wait', 'stop', 'hold', 'no', 'actually', 'cancel',
  'ruko', 'ruk', 'suno', 'sun', 'arre', 'are', 'nahi', 'ek second',
]);

export interface BargeInMetrics {
  lastBargeInMs: number | null;
  p95BargeInMs: number | null;
  bestCaseBargeInMs: number | null;
  sampleCount: number;
}

export class BargeInController {
  private interruptCandidate: { deadline: number; reason: string } | null = null;
  private samples: number[] = [];
  private ducked = false;

  constructor(
    private callbacks: {
      onDuck: (duck: boolean) => void;
      onInterrupt: (reason: string, interruptDetectedAt: number) => void;
    }
  ) {}

  /**
   * Fast path: early ASR transcript matches an interruption keyword.
   */
  evaluateTranscript(partialText: string): boolean {
    const firstWord = partialText
      .trim()
      .toLowerCase()
      .split(/\s+/)[0]
      ?.replace(/[.,!?]+$/, '');

    if (firstWord && INTERRUPT_KEYWORDS.has(firstWord)) {
      const now = performance.now();
      this.cancelCandidate();
      this.callbacks.onInterrupt(`keyword "${firstWord}"`, now);
      return true;
    }
    return false;
  }

  /**
   * Evaluates acoustic candidate while assistant is speaking.
   */
  evaluateAcoustics(
    speechHeldMs: number,
    gateResult: SpeakerGateResult,
    now: number = performance.now()
  ) {
    if (this.interruptCandidate) {
      // Inside candidate window (~250ms): confirm or reject
      if (gateResult.decision === 'barge_in_candidate' && speechHeldMs >= 240) {
        // Confirmed user barge-in
        const detectedAt = this.interruptCandidate.deadline - 250;
        this.cancelCandidate();
        this.callbacks.onInterrupt('speaker_gate_confirmed', detectedAt);
        return;
      }

      if (now >= this.interruptCandidate.deadline) {
        // Window expired without sufficient user voice evidence (e.g. keyboard click or cough)
        if (speechHeldMs >= 350 && gateResult.primarySpeakerScore >= 0.5) {
          this.cancelCandidate();
          this.callbacks.onInterrupt('energy_persistence', now);
        } else {
          // Revert duck and resume playback
          this.cancelCandidate();
          this.setDucked(false);
        }
      }
      return;
    }

    // New candidate trigger: sustained energy + primary speaker likelihood
    if (speechHeldMs >= 160 && gateResult.decision === 'barge_in_candidate') {
      this.interruptCandidate = { deadline: now + 250, reason: 'acoustic_candidate' };
      this.setDucked(true);
    }
  }

  recordLatency(ms: number) {
    if (ms >= 0 && ms < 5000) {
      this.samples.push(ms);
      if (this.samples.length > 30) this.samples.shift();
    }
  }

  getMetrics(): BargeInMetrics {
    if (this.samples.length === 0) {
      return { lastBargeInMs: null, p95BargeInMs: null, bestCaseBargeInMs: null, sampleCount: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      lastBargeInMs: this.samples[this.samples.length - 1] ?? null,
      p95BargeInMs: sorted[p95Idx] ?? null,
      bestCaseBargeInMs: sorted[0] ?? null,
      sampleCount: this.samples.length,
    };
  }

  cancelCandidate() {
    this.interruptCandidate = null;
    this.setDucked(false);
  }

  private setDucked(duck: boolean) {
    if (this.ducked !== duck) {
      this.ducked = duck;
      this.callbacks.onDuck(duck);
    }
  }
}
