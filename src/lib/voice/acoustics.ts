// Acoustic DSP core — PURE functions over audio frames, zero DOM.
// Everything here runs in Node against synthesized signals (see build
// notes) AND in the browser via acousticEngine.ts. No raw audio is ever
// stored; features are transient. Uncertain sounds → UNKNOWN, never forced.

export interface AcousticFeatures {
  rms: number;
  peak: number;
  dbfs: number; // 20*log10(rms), floored at -96
  zcr: number; // zero-crossing rate 0..1
  centroid: number; // spectral centroid, Hz
  rolloff: number; // 85% spectral rolloff, Hz
  flatness: number; // spectral flatness 0..1 (tone→0, noise→1)
  bandLow: number; // 20–300 Hz share
  bandMid: number; // 300–3000 Hz share (speech band)
  bandHigh: number; // 3k+ Hz share
  hum: number; // 45–65Hz energy share (mains hum detector)
  crestDb: number; // 20*log10(peak/rms): transients spike this
}

export const toDb = (v: number) => (v <= 0.00001 ? -96 : Math.max(-96, 20 * Math.log10(v)));

/** time: Float32 PCM [-1,1]; spectrum: LINEAR power per bin; sampleRate Hz. */
export function extractFeatures(
  time: Float32Array,
  power: Float32Array,
  sampleRate: number
): AcousticFeatures {
  let sum = 0;
  let peak = 0;
  let zc = 0;
  for (let i = 0; i < time.length; i++) {
    const v = time[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (i > 0 && (time[i - 1] < 0) !== (v < 0)) zc += 1;
  }
  const rms = Math.sqrt(sum / Math.max(1, time.length));
  const zcr = zc / Math.max(1, time.length);

  const binHz = sampleRate / 2 / Math.max(1, power.length);
  let total = 0;
  let wsum = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  let hum = 0;
  let logSum = 0;
  let logN = 0;
  const sorted: number[] = [];
  for (let i = 1; i < power.length; i++) {
    const p = Math.max(0, power[i]);
    const f = i * binHz;
    total += p;
    wsum += p * f;
    if (f < 300) low += p;
    else if (f < 3000) mid += p;
    else high += p;
    if (f >= 45 && f <= 65) hum += p;
    if (p > 1e-12) {
      logSum += Math.log(p);
      logN += 1;
    }
    sorted.push(p);
  }
  const centroid = total > 0 ? wsum / total : 0;
  sorted.sort((a, b) => a - b);
  let acc = 0;
  let rolloff = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i];
    if (acc >= total * 0.85) {
      rolloff = ((i + 1) / sorted.length) * (sampleRate / 2);
      break;
    }
  }
  const geoMean = logN > 0 ? Math.exp(logSum / logN) : 0;
  const arithMean = total / Math.max(1, power.length - 1);
  const flatness = arithMean > 0 ? Math.min(1, geoMean / arithMean) : 0;

  return {
    rms,
    peak,
    dbfs: toDb(rms),
    zcr,
    centroid,
    rolloff,
    flatness,
    bandLow: total > 0 ? low / total : 0,
    bandMid: total > 0 ? mid / total : 0,
    bandHigh: total > 0 ? high / total : 0,
    hum: total > 0 ? hum / total : 0,
    crestDb: rms > 0 ? 20 * Math.log10(Math.max(peak, 1e-9) / rms) : 0,
  };
}

/** Rolling baseline: slow-adapting floor, fast-attack signal, SNR. */
export class NoiseFloor {
  floor = 0.004;
  signal = 0.004;
  peakHold = 0;
  clipped = false;

  update(rms: number, peak: number) {
    // floor follows QUIET only (prevents speech from dragging it up);
    // loud beds move it very slowly (a room that stays loud IS louder)
    const k = rms < this.floor ? 0.03 : 0.0005;
    this.floor += (rms - this.floor) * k;
    // signal: fast attack, slow release
    const a = rms > this.signal ? 0.4 : 0.02;
    this.signal += (rms - this.signal) * a;
    this.peakHold = Math.max(peak, this.peakHold * 0.985);
    this.clipped = peak >= 0.985;
  }

  get floorDb() {
    return toDb(this.floor);
  }
  get signalDb() {
    return toDb(this.signal);
  }
  get snrDb() {
    if (this.floor <= 0) return 0;
    return Math.max(0, 20 * Math.log10(this.signal / Math.max(this.floor, 1e-9)));
  }
}

export type SoundClass =
  | 'silence'
  | 'speech'
  | 'stationary-noise' // fan / AC / traffic bed
  | 'music'
  | 'hum' // mains / electrical buzz
  | 'impact' // knock / clap / door / drop
  | 'unknown';

export interface SoundEvent {
  type: SoundClass;
  confidence: number; // 0.4–0.9, never theatrical 0.99
  foreground: boolean;
  detail: string;
}

/**
 * Single-frame heuristic classification + slow variance context.
 * variance01: 0 = glassy-stable spectrum (fan/hum/music), 1 = chaotic.
 * speech frames need mid-band dominance + speech-range ZCR + body.
 */
export function classifySound(
  f: AcousticFeatures,
  ctx: { variance01: number; floorDb: number }
): SoundEvent {
  if (f.dbfs < ctx.floorDb + 3) {
    return { type: 'silence', confidence: 0.85, foreground: false, detail: 'below floor+3dB' };
  }
  // sharp transient: knock / clap / door / drop / cough-onset
  if (f.crestDb > 16 && f.bandHigh > 0.3) {
    return { type: 'impact', confidence: 0.65, foreground: true, detail: `crest ${f.crestDb.toFixed(1)}dB, HF burst` };
  }
  // mains / electrical buzz: 50/60Hz energy + near-zero crossings.
  // ZCR is the tight feature here (50Hz → zcr ≈ 0.006 @16kHz).
  if (f.hum > 0.3 && f.zcr < 0.03) {
    return { type: 'hum', confidence: 0.75, foreground: false, detail: 'mains-band drone' };
  }
  // sustained + glassy + broadband → fan / AC / traffic bed
  if (ctx.variance01 < 0.25 && f.flatness > 0.45 && f.dbfs < ctx.floorDb + 14) {
    return { type: 'stationary-noise', confidence: 0.7, foreground: false, detail: 'stable broadband bed' };
  }
  // sustained + tonal + low ZCR → music bed (lyrics handled as speech only if mid-band speechy)
  if (ctx.variance01 < 0.35 && f.flatness < 0.3 && f.zcr < 0.12 && f.centroid < 2500) {
    return { type: 'music', confidence: 0.55, foreground: false, detail: 'stable tonal bed' };
  }
  // speech: mid-band body + speech ZCR + presence above floor + noisy
  // excitation (pure tones fail flatness) + human centroid range
  // (whistles/beeps sit far higher and fall through to unknown)
  if (f.bandMid > 0.4 && f.zcr > 0.04 && f.zcr < 0.45 && f.flatness > 0.12 && f.centroid < 2600 && f.dbfs > ctx.floorDb + 6) {
    const conf = f.bandMid > 0.6 && ctx.variance01 > 0.25 ? 0.8 : 0.6;
    return { type: 'speech', confidence: conf, foreground: true, detail: 'mid-band speech structure' };
  }
  return { type: 'unknown', confidence: 0.45, foreground: false, detail: 'no confident match — not forced' };
}

export type EnvironmentClass =
  | 'quiet-room'
  | 'normal'
  | 'noisy'
  | 'music'
  | 'multi-speech'
  | 'unknown-env';

export function environmentClass(o: {
  floorDb: number;
  music: boolean;
  backgroundSpeech: boolean;
  recentPeakDb: number;
}): EnvironmentClass {
  if (o.music) return 'music';
  if (o.backgroundSpeech) return 'multi-speech';
  if (o.floorDb < -50 && o.recentPeakDb < -30) return 'quiet-room';
  if (o.floorDb > -32) return 'noisy';
  if (o.floorDb < -96) return 'unknown-env';
  return 'normal';
}

/** Adaptive VAD floor from the noise baseline. Documented mapping. */
export function adaptiveThreshold(o: {
  floorDb: number;
  snrDb: number;
  echoActive: boolean;
}): { threshold: number; reason: string } {
  const floorLin = Math.pow(10, o.floorDb / 20);
  let t = floorLin * 3.2; // speech must clear ~10dB above floor
  const reasons: string[] = [`floor ${o.floorDb.toFixed(0)}dBFS`];
  if (o.snrDb > 15) {
    t *= 0.85;
    reasons.push('high SNR, lowered');
  }
  if (o.echoActive) {
    t *= 1.8;
    reasons.push('echo guard ×1.8');
  }
  const threshold = Math.min(0.14, Math.max(0.015, t));
  return { threshold, reason: reasons.join('; ') };
}

export interface FusionInput {
  speechProb: number; // VAD / classifier speech confidence
  primaryProb: number; // primary-user likelihood
  echoProb: number; // probability this is our own playback
  turnLike: number; // 0..1 linguistic turn likelihood
}

/** Calibrated interruption score (documented, no magic constants unexplained):
 *  speech × primary × (1−echo) × turn-gate. Confirm ≥0.55, candidate ≥0.3. */
export function fuseInterruption(i: FusionInput): { score: number; decision: 'ignore' | 'candidate' | 'confirm' } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const score = clamp(i.speechProb) * clamp(i.primaryProb) * (1 - clamp(i.echoProb)) * (0.5 + 0.5 * clamp(i.turnLike));
  return {
    score: Math.round(score * 100) / 100,
    decision: score >= 0.55 ? 'confirm' : score >= 0.3 ? 'candidate' : 'ignore',
  };
}
