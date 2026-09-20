// Acoustic engine: browser glue over the pure DSP core.
// Own analyser on the mic stream (VAD keeps its own — no refactor risk).
// Ticks ~11fps; publishes AcousticSnapshot; keeps an ephemeral incident
// chain (feature summaries + decisions, NEVER raw audio).

import {
  extractFeatures, NoiseFloor, classifySound, environmentClass,
  type SoundEvent, type EnvironmentClass,
} from './acoustics';

export interface AcousticSnapshot {
  dbfs: number;
  noiseFloorDb: number;
  snrDb: number;
  clipped: boolean;
  env: EnvironmentClass;
  music: boolean;
  backgroundSpeech: boolean;
  speechProb: number;
  primaryProb: number;
  echoProb: number;
  event: SoundEvent | null;
  recentEvents: { at: number; type: string; confidence: number }[];
  vadThreshold: number;
  vadReason: string;
}

export interface DeviceReport {
  aec: boolean | 'unknown';
  ns: boolean | 'unknown';
  agc: boolean | 'unknown';
  sampleRate: number | null;
  channels: number | null;
  latencyMs: number | null;
  label: string;
}

export interface Incident {
  t: number;
  kind: string;
  detail: string;
}

export function inspectStream(stream: MediaStream): DeviceReport {
  const t = stream.getAudioTracks()[0];
  const s = (t?.getSettings?.() ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const tri = (v: unknown): boolean | 'unknown' => (typeof v === 'boolean' ? v : 'unknown');
  return {
    aec: tri(s.echoCancellation),
    ns: tri(s.noiseSuppression),
    agc: tri(s.autoGainControl),
    sampleRate: num(s.sampleRate),
    channels: num(s.channelCount),
    latencyMs: num(s.latency),
    label: (t?.label || '').slice(0, 48),
  };
}

export class AcousticEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private time: Float32Array<ArrayBuffer> = new Float32Array(0);
  private freqDb: Float32Array<ArrayBuffer> = new Float32Array(0);
  private timer = 0;
  private floor = new NoiseFloor();
  private varRing: number[] = [];
  private lastEvent: string = 'silence';
  private lastEventAt = 0;
  private lastEmitted: SoundEvent | null = null;
  private events: { at: number; type: string; confidence: number }[] = [];
  private incidents: Incident[] = [];
  private musicVotes: number[] = [];
  private bgSpeechSince = 0;
  private speechLevel = 0.02;
  private modelSpeaking = false;
  private threshold = 0.032;
  private thresholdBase = 0.032;
  private running = false;

  constructor(
    private stream: MediaStream,
    private opts: {
      onEvent?: (e: SoundEvent) => void;
      thresholdBase?: number;
    } = {}
  ) {
    this.thresholdBase = opts.thresholdBase ?? 0.032;
    this.threshold = this.thresholdBase;
  }

  start() {
    if (this.running) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser);
    this.time = new Float32Array(this.analyser.fftSize);
    this.freqDb = new Float32Array(this.analyser.frequencyBinCount);
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      if (!document.hidden) this.sample(performance.now());
      this.timer = window.setTimeout(tick, 90);
    };
    tick();
  }

  stop() {
    this.running = false;
    window.clearTimeout(this.timer);
    try {
      this.analyser?.disconnect();
    } catch { /* ignore */ }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
  }

  setModelSpeaking(b: boolean) {
    this.modelSpeaking = b;
  }

  /** User sensitivity base; adaptive delta applies around it. */
  setThresholdBase(v: number) {
    this.thresholdBase = v;
  }

  note(kind: string, detail: string) {
    this.incidents.push({ t: Date.now(), kind, detail: detail.slice(0, 160) });
    if (this.incidents.length > 40) this.incidents.shift();
  }

  exportIncidents(): string {
    return JSON.stringify(
      { exportedAt: new Date().toISOString(), incidents: this.incidents, events: this.events },
      null,
      1
    );
  }

  private sample(now: number) {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.time);
    this.analyser.getFloatFrequencyData(this.freqDb);
    const sr = this.ctx?.sampleRate || 16000;
    // dB → linear power per bin
    const n = this.freqDb.length;
    const power = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const db = this.freqDb[i];
      power[i] = db <= -100 ? 0 : Math.pow(10, db / 10);
    }
    const f = extractFeatures(this.time, power, sr);
    this.floor.update(f.rms, f.peak);

    // variance over ~1s window (spectral spread of mid-band)
    this.varRing.push(f.bandMid);
    if (this.varRing.length > 11) this.varRing.shift();
    const mean = this.varRing.reduce((a, b) => a + b, 0) / this.varRing.length;
    const variance01 = Math.min(1, Math.sqrt(this.varRing.reduce((a, b) => a + (b - mean) * (b - mean), 0) / this.varRing.length) * 4);

    const ev = classifySound(f, { variance01, floorDb: this.floor.floorDb });
    if (ev.type !== this.lastEvent && now - this.lastEventAt > 350 && ev.confidence >= 0.5) {
      this.lastEvent = ev.type;
      this.lastEventAt = now;
      this.lastEmitted = ev;
      this.events.push({ at: now, type: ev.type, confidence: ev.confidence });
      if (this.events.length > 20) this.events.shift();
      this.note('sound', `${ev.type} ${ev.confidence} (${ev.detail})`);
      this.opts.onEvent?.(ev);
    }

    // music latch: 3 of last 5 ticks
    this.musicVotes.push(ev.type === 'music' ? 1 : 0);
    if (this.musicVotes.length > 5) this.musicVotes.shift();
    const music = this.musicVotes.filter(Boolean).length >= 3;

    // background speech: speech-like + quiet + sustained (not the user)
    const quietSpeech = ev.type === 'speech' && f.dbfs < this.floor.floorDb + 10;
    if (quietSpeech) {
      if (!this.bgSpeechSince) this.bgSpeechSince = now;
    } else if (ev.type !== 'speech') {
      this.bgSpeechSince = 0;
    }
    const backgroundSpeech = this.bgSpeechSince > 0 && now - this.bgSpeechSince > 1200;

    // primary-user estimate: foreground speech near/above learned speech level
    if (ev.type === 'speech' && ev.foreground && !this.modelSpeaking) {
      this.speechLevel += (f.rms - this.speechLevel) * 0.08;
    }
    const speechProb = ev.type === 'speech' ? ev.confidence : ev.type === 'impact' ? 0.25 : 0.05;
    const primaryProb =
      ev.type !== 'speech'
        ? 0.1
        : Math.min(0.92, 0.35 + 0.55 * (f.rms / Math.max(this.speechLevel, 0.004)));

    // adaptive VAD floor around the user's sensitivity base
    const floorLin = Math.pow(10, this.floor.floorDb / 20);
    let t = floorLin * 3.2;
    if (this.floor.snrDb > 15) t *= 0.85;
    if (this.modelSpeaking) t *= 1.8;
    const adapted = Math.min(0.14, Math.max(0.015, t));
    // delta-preserving blend: user base shifted by (adapted − default)
    this.threshold = Math.min(0.14, Math.max(0.012, this.thresholdBase + (adapted - 0.032)));

    this.snap = {
      dbfs: Math.round(f.dbfs * 10) / 10,
      noiseFloorDb: Math.round(this.floor.floorDb * 10) / 10,
      snrDb: Math.round(this.floor.snrDb * 10) / 10,
      clipped: this.floor.clipped,
      env: environmentClass({
        floorDb: this.floor.floorDb,
        music,
        backgroundSpeech,
        recentPeakDb: 20 * Math.log10(Math.max(this.floor.peakHold, 1e-9)),
      }),
      music,
      backgroundSpeech,
      speechProb: Math.round(speechProb * 100) / 100,
      primaryProb: Math.round(primaryProb * 100) / 100,
      echoProb: this.modelSpeaking
        ? Math.round(Math.min(0.8, 0.3 + 0.4 * Math.max(0, (f.dbfs - this.floor.floorDb) / 24)) * 100) / 100
        : 0,
      event: this.lastEmitted,
      recentEvents: [...this.events].reverse().slice(0, 6),
      vadThreshold: Math.round(this.threshold * 10000) / 10000,
      vadReason: `floor ${this.floor.floorDb.toFixed(0)}dB${this.modelSpeaking ? ' +echo guard' : ''}`,
    };
  }

  private snap: AcousticSnapshot = {
    dbfs: -96,
    noiseFloorDb: -96,
    snrDb: 0,
    clipped: false,
    env: 'unknown-env',
    music: false,
    backgroundSpeech: false,
    speechProb: 0,
    primaryProb: 0,
    echoProb: 0,
    event: null,
    recentEvents: [],
    vadThreshold: 0.032,
    vadReason: 'starting',
  };

  snapshot(): AcousticSnapshot {
    return { ...this.snap, recentEvents: [...this.snap.recentEvents] };
  }
}
