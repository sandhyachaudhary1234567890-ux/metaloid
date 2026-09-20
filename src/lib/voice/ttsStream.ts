// Adaptive Lookahead TTS Stream Controller.
// Enforces: ACTIVE AUDIO + 1 READY CHUNK + 1 OPTIONAL PREFETCH CHUNK.
// Dynamically adjusts lookahead based on synthesis latency and user interruption rate.
// Provides atomic cancellation on interruption and gapless chunk playback.

import type { SpeechChunk, VoiceProfile } from './types';
import { defaultSpeechRenderer } from './speechRenderer';
import { SpeechSynthesisTTS, type SpeakOutcome } from './tts';
import { planSpeech } from './speech';

export interface TTSStreamCallbacks {
  onAudioStart?: (chunk: SpeechChunk) => void;
  onChunkCompleted?: (chunk: SpeechChunk) => void;
  onWordBoundary?: (charIndex: number, text: string, phrase: string) => void;
  onStateChange?: (isPlaying: boolean) => void;
}

export class TTSStreamController {
  private tts = new SpeechSynthesisTTS();
  private currentGen = -1;
  private currentTurnId = '';
  private activeChunk: SpeechChunk | null = null;
  private readyQueue: SpeechChunk[] = [];
  private isPumping = false;
  private userInterruptionCount = 0;
  private recentSynthesisTimes: number[] = [];
  private cb: TTSStreamCallbacks = {};

  constructor(callbacks: TTSStreamCallbacks = {}) {
    this.cb = callbacks;
  }

  setCallbacks(callbacks: TTSStreamCallbacks) {
    this.cb = { ...this.cb, ...callbacks };
  }

  noteUserInterruption() {
    this.userInterruptionCount++;
    // When interruptions happen, drop lookahead immediately to reduce waste
    this.readyQueue = this.readyQueue.slice(0, 1);
  }

  /**
   * Adaptive lookahead limit calculation:
   * Base: 1 ready chunk + 1 optional prefetch chunk (2 max pending).
   * High interruption rate -> drops to 1.
   * High synthesis latency -> allows up to 2.
   */
  getMaxLookahead(): number {
    if (this.userInterruptionCount >= 2) {
      return 1;
    }
    const avgLatency =
      this.recentSynthesisTimes.length > 0
        ? this.recentSynthesisTimes.reduce((a, b) => a + b, 0) / this.recentSynthesisTimes.length
        : 150;

    return avgLatency > 700 ? 2 : 1;
  }

  adopt(generation: number, turnId = '') {
    this.currentGen = generation;
    this.currentTurnId = turnId;
    this.readyQueue = this.readyQueue.filter((c) => c.sourceGenerationId === generation);
  }

  isCurrent(gen: number): boolean {
    return gen === this.currentGen;
  }

  getActiveChunk(): SpeechChunk | null {
    return this.activeChunk;
  }

  getPendingCount(): number {
    return this.readyQueue.length + (this.activeChunk ? 1 : 0);
  }

  /**
   * Enqueue a new speech-ready chunk for playback.
   */
  enqueue(chunk: SpeechChunk, profile: VoiceProfile) {
    if (chunk.sourceGenerationId !== this.currentGen) return;

    // 1. Render through deterministic SpeechRenderer
    chunk.spokenText = defaultSpeechRenderer.render(chunk.text);
    if (!chunk.spokenText.trim()) return;

    // 2. Enforce adaptive lookahead buffer limit
    const maxLookahead = this.getMaxLookahead();
    if (this.readyQueue.length >= maxLookahead) {
      // Fold into existing tail chunk to avoid queue overflow
      const tail = this.readyQueue[this.readyQueue.length - 1];
      if (tail) {
        tail.text += ' ' + chunk.text;
        tail.spokenText += ' ' + chunk.spokenText;
        return;
      }
    }

    chunk.status = 'READY';
    this.readyQueue.push(chunk);
    void this.pump(profile);
  }

  /**
   * Main playback pumping loop: plays active and prefetches next.
   */
  private async pump(profile: VoiceProfile): Promise<void> {
    if (this.isPumping) return;
    this.isPumping = true;

    try {
      while (this.readyQueue.length > 0) {
        const next = this.readyQueue.shift();
        if (!next || !this.isCurrent(next.sourceGenerationId)) continue;

        this.activeChunk = next;
        next.status = 'PLAYING';
        this.cb.onStateChange?.(true);

        const startTime = performance.now();
        const speechPlans = planSpeech(next.spokenText, profile.rate);

        for (const plan of speechPlans) {
          if (!this.isCurrent(next.sourceGenerationId)) {
            next.status = 'CANCELLED';
            break;
          }

          const outcome: SpeakOutcome = await this.tts.speak(plan, {
            profile,
            generation: next.sourceGenerationId,
            audioGenerationId: next.sourceGenerationId,
            turnId: next.turnId,
            chunkId: next.id,
            isCurrent: () => this.isCurrent(next.sourceGenerationId),
            isCurrentGeneration: (gen) => this.isCurrent(gen),
            onStart: () => {
              this.cb.onAudioStart?.(next);
            },
            onWord: (charIndex, text) => {
              if (this.isCurrent(next.sourceGenerationId)) {
                this.cb.onWordBoundary?.(charIndex, text, next.spokenText);
              }
            },
          });

          if (outcome === 'cancelled' || outcome === 'stale') {
            next.status = 'CANCELLED';
            break;
          }
        }

        const elapsed = performance.now() - startTime;
        this.recentSynthesisTimes.push(elapsed);
        if (this.recentSynthesisTimes.length > 5) this.recentSynthesisTimes.shift();

        if (next.status === 'PLAYING') {
          next.status = 'PLAYED';
          this.cb.onChunkCompleted?.(next);
        }

        this.activeChunk = null;
      }
    } finally {
      this.isPumping = false;
      this.activeChunk = null;
      this.cb.onStateChange?.(false);
    }
  }

  /**
   * Drain: awaits until all queued audio finishes playing for this generation.
   */
  async drain(generation: number, profile: VoiceProfile): Promise<void> {
    for (;;) {
      await this.pump(profile);
      if (!this.isCurrent(generation)) break;
      if (this.readyQueue.length === 0 && !this.isPumping) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /**
   * Atomic cancel on barge-in.
   * Cancels browser SpeechSynthesis immediately and purges all queues.
   */
  cancel() {
    this.readyQueue.forEach((c) => {
      c.status = 'CANCELLED';
    });
    this.readyQueue = [];
    if (this.activeChunk) {
      this.activeChunk.status = 'CANCELLED';
      this.activeChunk = null;
    }
    this.tts.cancel();
    this.cb.onStateChange?.(false);
  }

  pause() {
    this.tts.pause();
  }

  resume() {
    this.tts.resume();
  }
}
