// Chunked TTS provider (§5, §11): speechSynthesis with honest non-streaming fallback.
// Enforces generation tokens (audioGenerationId, turnId, chunkId) so stale audio can NEVER play.
// Prevents Blink/Chrome garbage collection silent drops via persistent activeUtterances Set.
// Provides automatic pause/hang recovery watchdog.

import type { SpeechPlan, TtsCapabilities, VoiceProfile } from './types';
import { TTS_CAPS } from './speech';

export interface SpeakOpts {
  profile: VoiceProfile;
  generation: number;
  audioGenerationId?: number;
  turnId?: string;
  chunkId?: string;
  isCurrent: () => boolean;
  isCurrentGeneration?: (gen: number) => boolean;
  onWord?: (charIndex: number, text: string) => void;
  onStart?: () => void;
}

export type SpeakOutcome = 'done' | 'cancelled' | 'stale' | 'unsupported';

export class SpeechSynthesisTTS {
  capabilities: TtsCapabilities = TTS_CAPS;
  private lastCancelAt = 0;
  private emptyVoiceWaits = 0;
  // Garbage collection protection: retain active utterances until finished
  private static activeUtterances: Set<SpeechSynthesisUtterance> = new Set();

  supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  pickVoice(lang: string, preferName?: string): SpeechSynthesisVoice | null {
    if (!this.supported()) return null;
    const vs = window.speechSynthesis.getVoices();
    if (!vs.length) return null;
    const base = lang.split('-')[0].toLowerCase();
    if (preferName) {
      const named = vs.find((v) => v.name.toLowerCase().includes(preferName.toLowerCase()));
      if (named) return named;
    }
    return (
      vs.find((v) => v.lang.toLowerCase().startsWith(base) && v.localService) ||
      vs.find((v) => v.lang.toLowerCase().startsWith(base)) ||
      vs.find((v) => v.default) ||
      vs[0]
    );
  }

  /** Speak one plan. Resolves stale if a newer generation took over. Never hangs. */
  speak(plan: SpeechPlan, opts: SpeakOpts): Promise<SpeakOutcome> {
    return new Promise((resolve) => {
      let settled = false;
      let currentUtterance: SpeechSynthesisUtterance | null = null;

      const done = (v: SpeakOutcome) => {
        if (!settled) {
          settled = true;
          if (currentUtterance) {
            SpeechSynthesisTTS.activeUtterances.delete(currentUtterance);
          }
          resolve(v);
        }
      };

      if (!this.supported()) {
        done('unsupported');
        return;
      }

      // Generation token check before starting
      if (!opts.isCurrent()) {
        done('stale');
        return;
      }
      if (opts.audioGenerationId !== undefined && opts.isCurrentGeneration && !opts.isCurrentGeneration(opts.audioGenerationId)) {
        done('stale');
        return;
      }

      const utter = () => {
        // Double check generation before speaking
        if (!opts.isCurrent()) {
          done('stale');
          return;
        }
        if (opts.audioGenerationId !== undefined && opts.isCurrentGeneration && !opts.isCurrentGeneration(opts.audioGenerationId)) {
          done('stale');
          return;
        }

        // Chrome engine pause/hang watchdog recovery
        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch { /* ignore */ }

        const gap = Date.now() - this.lastCancelAt;
        const wait = gap < 140 ? 140 - gap : 0;

        window.setTimeout(() => {
          if (!opts.isCurrent()) {
            done('stale');
            return;
          }

          const u = new SpeechSynthesisUtterance(plan.text);
          currentUtterance = u;
          // Retain in active set to prevent Chrome GC dropping speech mid-sentence
          SpeechSynthesisTTS.activeUtterances.add(u);

          const voice = this.pickVoice(opts.profile.lang, opts.profile.voiceId || undefined);
          if (voice) u.voice = voice;
          u.lang = opts.profile.lang;
          u.rate = plan.rate;
          u.pitch = 1;
          u.volume = 1;

          let started = false;
          u.onstart = () => {
            started = true;
            opts.onStart?.();
          };

          u.onboundary = (e) => {
            if (e.name === 'word' && opts.isCurrent()) {
              opts.onWord?.(e.charIndex, plan.text);
            }
          };

          u.onend = () => {
            SpeechSynthesisTTS.activeUtterances.delete(u);
            done(opts.isCurrent() ? 'done' : 'stale');
          };

          u.onerror = () => {
            SpeechSynthesisTTS.activeUtterances.delete(u);
            if (!started && !opts.isCurrent()) done('stale');
            else done('cancelled');
          };

          // Watchdog: bound maximum utterance duration
          window.setTimeout(() => {
            if (!started) {
              SpeechSynthesisTTS.activeUtterances.delete(u);
              done(opts.isCurrent() ? 'cancelled' : 'stale');
            }
          }, 8000);

          if (plan.pauseBeforeMs > 0) {
            window.setTimeout(() => {
              if (!opts.isCurrent()) {
                SpeechSynthesisTTS.activeUtterances.delete(u);
                done('stale');
                return;
              }
              window.speechSynthesis.speak(u);
            }, Math.min(plan.pauseBeforeMs, 220));
          } else {
            window.speechSynthesis.speak(u);
          }
        }, wait);
      };

      let uttered = false;
      const utterOnce = () => {
        if (uttered) return;
        uttered = true;
        utter();
      };

      if (window.speechSynthesis.getVoices().length > 0) {
        this.emptyVoiceWaits = 0;
        utterOnce();
      } else if (this.emptyVoiceWaits >= 3) {
        utterOnce();
      } else {
        const iv = window.setInterval(() => {
          if (window.speechSynthesis.getVoices().length > 0 || !opts.isCurrent()) {
            window.clearInterval(iv);
            utterOnce();
          }
        }, 60);
        window.setTimeout(() => {
          window.clearInterval(iv);
          this.emptyVoiceWaits += 1;
          utterOnce();
        }, 1500);
      }
    });
  }

  /** Atomic clear — barge-in primitive. Clears activeUtterances and cancels engine. */
  cancel(): void {
    this.lastCancelAt = Date.now();
    SpeechSynthesisTTS.activeUtterances.clear();
    if (!this.supported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch { /* engine busy */ }
  }

  pause(): void {
    try {
      window.speechSynthesis.pause();
    } catch { /* ignore */ }
  }

  resume(): void {
    try {
      window.speechSynthesis.resume();
    } catch { /* ignore */ }
  }
}
