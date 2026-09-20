// Client energy VAD (§9): RMS over AnalyserNode, speech/silence hangover,
// raised threshold while the model speaks (echo guard), level tap for UI.
// Conservative by design: never clip word edges (prefix padding via
// minSpeechMs + generous release).

import type { VadConfig } from './types';

export interface VadEvents {
  onSpeechStart?: () => void;
  onSpeechEnd?: (durationMs: number) => void;
  onLevel?: (level: number) => void;
}

const DEFAULTS: VadConfig = {
  threshold: 0.032, // sensitive enough for laptop mics; release ratio guards noise
  speakingThreshold: 0.11,
  silenceMs: 750,
  minSpeechMs: 180,
  interruptMs: 320,
};

/** User-facing sensitivity → RMS floor. Low for noisy rooms, High for quiet. */
export const VAD_SENSITIVITY: Record<'Low' | 'Medium' | 'High', number> = {
  Low: 0.05,
  Medium: 0.032,
  High: 0.018,
};

export class EnergyVad {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private cfg: VadConfig;
  private ev: VadEvents;
  private speaking = false;
  private speechSince = 0;
  private silenceSince = 0;
  private lastT = 0;
  private lastEmit = 0;
  private modelSpeaking = false;
  private running = false;

  constructor(cfg: Partial<VadConfig> = {}, ev: VadEvents = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.ev = ev;
  }

  async attach(stream: MediaStream) {
    this.detach();
    this.stream = stream;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.35;
    this.src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.running = true;
    this.lastT = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  /** Echo guard input: raise the floor while model audio plays. */
  setModelSpeaking(b: boolean) {
    this.modelSpeaking = b;
  }

  /** Adaptive floor from the acoustic engine (user base preserved in session). */
  setFloor(v: number) {
    this.cfg.threshold = v;
    this.cfg.speakingThreshold = Math.max(0.11, v * 2.4);
  }

  /** Current sustained-speech clock (ms) — used for barge-in gating. */
  speechHeldMs(): number {
    if (!this.speaking) return 0;
    return performance.now() - this.speechSince;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  private tick() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    const now = performance.now();
    const floor = this.modelSpeaking ? this.cfg.speakingThreshold! : this.cfg.threshold;
    // level tap throttled to ~10fps — drives the waveform without re-render storms
    if (now - this.lastEmit > 100) {
      this.lastEmit = now;
      this.ev.onLevel?.(Math.min(1, rms * 6));
    }

    if (!this.speaking && rms >= floor) {
      this.speaking = true;
      this.speechSince = now;
      this.silenceSince = 0;
    } else if (this.speaking) {
      if (rms >= floor * 0.6) {
        this.silenceSince = 0;
      } else {
        if (!this.silenceSince) this.silenceSince = now;
        const spokenFor = now - this.speechSince;
        if (now - this.silenceSince >= this.cfg.silenceMs && spokenFor >= this.cfg.minSpeechMs) {
          this.speaking = false;
          const dur = now - this.speechSince;
          this.silenceSince = 0;
          this.ev.onSpeechEnd?.(dur);
          return;
        }
      }
    }
    // speech-start fires on first crossing (UI reacts instantly; turn logic
    // confirms via minSpeechMs downstream)
    if (this.speaking && now - this.speechSince < 50) this.ev.onSpeechStart?.();
    void this.lastT;
    this.lastT = now;
  }

  detach() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try {
      this.src?.disconnect();
    } catch { /* ignore */ }
    try {
      this.analyser?.disconnect();
    } catch { /* ignore */ }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
    this.src = null;
    this.speaking = false;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }
}
