// Formal voice state machine (§10). Explicit transitions only —
// no scattered booleans. Subscribers (UI) sync from getState().

import type { VoiceState } from './types';

const TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  IDLE: ['LISTENING', 'ERROR'],
  LISTENING: ['USER_SPEAKING', 'TURN_CANDIDATE', 'PROCESSING', 'IDLE', 'ERROR'],
  USER_SPEAKING: ['TURN_CANDIDATE', 'PROCESSING', 'LISTENING', 'IDLE', 'ERROR'],
  TURN_CANDIDATE: ['USER_SPEAKING', 'PROCESSING', 'LISTENING', 'IDLE', 'ERROR'],
  PROCESSING: ['MODEL_SPEAKING', 'USER_INTERRUPT', 'LISTENING', 'ERROR', 'IDLE'],
  MODEL_SPEAKING: ['USER_INTERRUPT', 'LISTENING', 'IDLE', 'ERROR'],
  USER_INTERRUPT: ['CANCELLING', 'LISTENING'],
  CANCELLING: ['LISTENING', 'RECOVERING', 'ERROR'],
  RECOVERING: ['LISTENING', 'ERROR', 'IDLE'],
  ERROR: ['RECOVERING', 'IDLE', 'LISTENING'],
};

export class VoiceMachine {
  private state: VoiceState = 'IDLE';
  private subs = new Set<(s: VoiceState, prev: VoiceState) => void>();
  private log: { at: number; from: VoiceState; to: VoiceState }[] = [];

  getState(): VoiceState {
    return this.state;
  }

  history() {
    return [...this.log];
  }

  subscribe(fn: (s: VoiceState, prev: VoiceState) => void): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  /** Returns true if the transition was legal and applied. */
  go(next: VoiceState): boolean {
    const allowed = TRANSITIONS[this.state] || [];
    if (!allowed.includes(next)) return false;
    const prev = this.state;
    this.state = next;
    this.log.push({ at: performance.now(), from: prev, to: next });
    if (this.log.length > 80) this.log.shift();
    for (const fn of this.subs) {
      try {
        fn(next, prev);
      } catch { /* subscriber fault isolated */ }
    }
    return true;
  }

  /** Forced reset (close panel, fatal error path). Always legal. */
  reset(to: VoiceState = 'IDLE') {
    const prev = this.state;
    this.state = to;
    this.log.push({ at: performance.now(), from: prev, to });
    for (const fn of this.subs) {
      try {
        fn(to, prev);
      } catch { /* isolated */ }
    }
  }
}

export const STATE_LABEL: Record<VoiceState, string> = {
  IDLE: 'Ready',
  LISTENING: 'Listening…',
  USER_SPEAKING: 'Hearing…',
  TURN_CANDIDATE: 'Evaluating…',
  PROCESSING: 'Processing…',
  MODEL_SPEAKING: 'Speaking…',
  USER_INTERRUPT: 'Interrupted',
  CANCELLING: 'Stopping…',
  RECOVERING: 'Recovering…',
  ERROR: 'Voice unavailable',
};
