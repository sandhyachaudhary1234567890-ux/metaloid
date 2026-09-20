// Audio queue (§6, §26–27): CURRENTLY_PLAYING → NEXT → QUEUED, bounded,
// generation-gated. Stale generations can never sound: every dequeue
// re-checks currency, and cancel() atomically clears the engine.
// Backpressure: cap pending; overflow merges into one tail segment.

import type { SpeechPlan, VoiceProfile } from './types';
import { planSpeech } from './speech';
import { SpeechSynthesisTTS, type SpeakOutcome } from './tts';

const MAX_PENDING = 5;

interface QueueItem {
  plan: SpeechPlan;
  generation: number;
  profile: VoiceProfile;
  resolve: (v: SpeakOutcome) => void;
  onWord?: (charIndex: number, text: string) => void;
  onStart?: () => void;
}

export class AudioQueue {
  private tts = new SpeechSynthesisTTS();
  private pending: QueueItem[] = [];
  private pumping = false;
  private currentGen = -1;
  private currentText = '';
  private paused = false;

  supported(): boolean {
    return this.tts.supported();
  }

  /** Adopt a generation as current; older pending items become invalid. */
  adopt(generation: number) {
    this.currentGen = generation;
    this.pending = this.pending.filter((q) => q.generation === generation);
  }

  private isCurrent = (gen: number) => gen === this.currentGen;

  current(): { text: string; generation: number } {
    return { text: this.currentText, generation: this.currentGen };
  }

  pendingCount(): number {
    return this.pending.length;
  }

  /** Enqueue a segment's speech plans. Resolves per plan outcome. */
  enqueueSegment(segment: string, generation: number, profile: VoiceProfile, hooks?: { onWord?: QueueItem['onWord']; onStart?: QueueItem['onStart'] }) {
    if (!segment.trim()) return;
    // overflow: fold the tail into the last pending item to bound memory
    const plans = planSpeech(segment, profile.rate);
    for (const plan of plans) {
      if (this.pending.length >= MAX_PENDING) {
        const last = this.pending[this.pending.length - 1];
        if (last && last.generation === generation) {
          last.plan = { ...last.plan, text: `${last.plan.text} ${plan.text}` };
          continue;
        }
      }
      this.pending.push({
        plan,
        generation,
        profile,
        resolve: () => {},
        onWord: hooks?.onWord,
        onStart: hooks?.onStart,
      });
    }
    void this.pump();
  }

  /** Finish: enqueue final plans then resolve when drained (or invalidated). */
  async drain(generation: number): Promise<void> {
    // NOTE: a concurrent pump() owns the loop; awaiting IT resolves early.
    // Wait for true emptiness instead — otherwise turnEnd/LISTENING fire
    // while audio still plays and the state machine lies.
    for (;;) {
      await this.pump(generation);
      if (!this.isCurrent(generation)) break; // invalidated — stop waiting
      if (this.pending.length === 0 && !this.pumping) break; // truly drained
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  private async pump(untilGen?: number): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.paused) {
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        const next = this.pending[0];
        if (!next) break;
        if (untilGen !== undefined && next.generation !== untilGen && this.pending.every((q) => q.generation !== untilGen)) break;
        this.pending.shift();
        if (!this.isCurrent(next.generation)) {
          next.resolve('stale');
          continue;
        }
        this.currentText = next.plan.text;
        const out = await this.tts.speak(next.plan, {
          profile: next.profile,
          generation: next.generation,
          isCurrent: () => this.isCurrent(next.generation) && !this.paused,
          onWord: next.onWord,
          onStart: next.onStart,
        });
        next.resolve(out);
        if (out === 'cancelled' || out === 'stale') {
          // generation moved on — drop the rest of the old line
          this.pending = this.pending.filter((q) => this.isCurrent(q.generation));
          if (!this.pending.length) break;
        }
      }
    } finally {
      this.pumping = false;
      this.currentText = '';
    }
  }

  /** Barge-in path: invalidate generation + atomic engine clear. */
  invalidate(generation: number) {
    this.currentGen = generation;
    this.pending = this.pending.filter((q) => q.generation === generation);
    this.tts.cancel();
  }

  clear() {
    this.pending = [];
    this.paused = false; // a cleared queue is never paused (duck state dies here)
    this.tts.cancel();
  }

  pause() {
    this.paused = true;
    this.tts.pause();
  }

  resume() {
    this.paused = false;
    this.tts.resume();
    void this.pump();
  }
}
