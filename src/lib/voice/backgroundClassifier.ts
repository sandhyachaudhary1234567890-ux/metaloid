// Two-tier background sound classifier & speaker consistency gate.
// Tier 1: Robust Speech vs Noise differentiation.
// Tier 2: Speaker Consistency Gate (user voice vs background vs playback echo).
// Handcrafted labels (keyboard, fan, AC, etc.) are diagnostic telemetry.

import type { DiagnosticSoundClass, SpeakerConsistency } from './types';
import type { AcousticFeatures } from './acoustics';

export interface ClassifierOptions {
  userSpeechFloorDb?: number;
  echoGuardActive?: boolean;
}

export interface SpeakerGateResult {
  isUserVoice: boolean;
  confidence: number;
  primarySpeakerScore: number;
  echoProbability: number;
  decision: 'barge_in_candidate' | 'ignore';
  diagnosticClass: DiagnosticSoundClass;
  detail: string;
}

export class BackgroundClassifier {
  private userVoiceEnergyFloor = 0.025; // Learned user speech energy
  private userEnergyAlpha = 0.05;
  private consecutiveUserFrames = 0;
  private consecutiveNoiseFrames = 0;
  private modelSpeaking = false;
  private history: { isSpeech: boolean; rms: number; class: DiagnosticSoundClass }[] = [];

  setModelSpeaking(speaking: boolean) {
    this.modelSpeaking = speaking;
  }

  setUserSpeechBase(rms: number) {
    if (rms > 0.01) {
      this.userVoiceEnergyFloor = rms;
    }
  }

  /**
   * Evaluate an acoustic frame through the two-tier speaker consistency gate.
   */
  evaluate(
    features: AcousticFeatures,
    ctx: { floorDb: number; variance01: number }
  ): SpeakerGateResult {
    const { rms, dbfs, bandMid, bandHigh, crestDb, flatness, zcr, centroid, hum } = features;
    const { floorDb, variance01 } = ctx;

    // --- TIER 1: Acoustic Speech vs Non-Speech Detection ---
    // Genuine speech requires mid-band dominance (300-3400Hz), human zero-crossing rate,
    // vocal tract formant presence, and sufficient margin above ambient floor.
    const hasSpeechMidBand = bandMid >= 0.42;
    const hasSpeechZcr = zcr >= 0.035 && zcr <= 0.46;
    const clearsNoiseFloor = dbfs >= floorDb + 5.5;
    const isHumanVocalCentroid = centroid >= 250 && centroid <= 3200;
    const isNotPureTone = flatness >= 0.08;

    const speechScore =
      (hasSpeechMidBand ? 0.35 : 0) +
      (hasSpeechZcr ? 0.25 : 0) +
      (clearsNoiseFloor ? 0.25 : 0) +
      (isHumanVocalCentroid ? 0.15 : 0);

    const isAcousticSpeech = speechScore >= 0.65 && isNotPureTone;

    // --- TIER 2: Speaker Consistency & Echo Evaluation ---
    // Contrast incoming speech against learned primary speaker level and model playback
    let echoProbability = 0;
    if (this.modelSpeaking) {
      // While assistant is speaking, speaker output reflects into the microphone.
      // Acoustic echo typically hovers within 6-18dB of the baseline floor.
      const marginOverFloor = dbfs - floorDb;
      echoProbability = Math.min(0.85, Math.max(0.15, marginOverFloor / 28));
    }

    // Adapt user speech level ONLY when assistant is quiet and speech is unambiguous
    if (isAcousticSpeech && !this.modelSpeaking && rms > this.userVoiceEnergyFloor * 0.7) {
      this.userVoiceEnergyFloor += (rms - this.userVoiceEnergyFloor) * this.userEnergyAlpha;
    }

    const energyRatio = rms / Math.max(0.005, this.userVoiceEnergyFloor);
    const primarySpeakerScore = Math.min(1, Math.max(0.1, energyRatio * 0.75 + (clearsNoiseFloor ? 0.25 : 0)));

    // Asymmetric hysteresis: requires 2 consecutive speech frames to turn ON,
    // but 3 quiet frames to turn OFF.
    if (isAcousticSpeech && primarySpeakerScore >= 0.55 && echoProbability < 0.65) {
      this.consecutiveUserFrames++;
      this.consecutiveNoiseFrames = 0;
    } else {
      this.consecutiveNoiseFrames++;
      if (this.consecutiveNoiseFrames >= 3) {
        this.consecutiveUserFrames = 0;
      }
    }

    const isUserVoice = this.consecutiveUserFrames >= 2;
    const confidence = isUserVoice
      ? Math.min(0.95, primarySpeakerScore * (1 - echoProbability * 0.5))
      : Math.max(0.05, 1 - primarySpeakerScore);

    // Decision for barge-in gating:
    // User voice clearing primary speaker score without heavy echo -> barge in
    const decision: 'barge_in_candidate' | 'ignore' =
      isUserVoice && primarySpeakerScore >= 0.52 && (!this.modelSpeaking || energyRatio >= 1.25)
        ? 'barge_in_candidate'
        : 'ignore';

    // --- DIAGNOSTIC CLASSIFICATION (Observability & UI) ---
    const diagnosticClass = this.classifyDiagnostic(features, ctx, isAcousticSpeech, isUserVoice);

    // Log history
    this.history.push({ isSpeech: isAcousticSpeech, rms, class: diagnosticClass });
    if (this.history.length > 25) this.history.shift();

    return {
      isUserVoice,
      confidence: Math.round(confidence * 100) / 100,
      primarySpeakerScore: Math.round(primarySpeakerScore * 100) / 100,
      echoProbability: Math.round(echoProbability * 100) / 100,
      decision,
      diagnosticClass,
      detail: `${diagnosticClass} (mid: ${(bandMid * 100).toFixed(0)}%, p-score: ${primarySpeakerScore.toFixed(2)})`,
    };
  }

  /**
   * Diagnostic labels for observability: Keyboard, Fan, AC, Mouse, etc.
   */
  private classifyDiagnostic(
    f: AcousticFeatures,
    ctx: { floorDb: number; variance01: number },
    isSpeech: boolean,
    isUser: boolean
  ): DiagnosticSoundClass {
    if (f.dbfs < ctx.floorDb + 3) {
      return 'UNKNOWN_NOISE';
    }

    // High crest factor + high frequency energy = keyboard click or mouse click or door knock
    if (f.crestDb > 16 && f.bandHigh > 0.32) {
      return f.crestDb > 20 ? 'KEYBOARD' : 'MOUSE';
    }

    // Door impact / clap
    if (f.crestDb > 18 && f.bandLow > 0.4) {
      return 'DOOR';
    }

    // Broadband stationary noise: fan or AC
    if (ctx.variance01 < 0.22 && f.flatness > 0.5 && f.dbfs < ctx.floorDb + 16) {
      return f.centroid > 1200 ? 'FAN' : 'AC';
    }

    // Music bed: stable tonal structure
    if (ctx.variance01 < 0.32 && f.flatness < 0.28 && f.zcr < 0.12) {
      return 'MUSIC';
    }

    // Human speech classification
    if (isSpeech) {
      if (isUser) {
        return this.consecutiveUserFrames === 2 ? 'USER_SPEECH_START' : 'USER_SPEECH';
      }
      return this.modelSpeaking ? 'UNKNOWN_NOISE' : 'BACKGROUND_VOICE';
    }

    return 'UNKNOWN_NOISE';
  }

  snapshot(currentResult?: SpeakerGateResult): SpeakerConsistency {
    return {
      isUserVoice: currentResult?.isUserVoice ?? (this.consecutiveUserFrames >= 2),
      speechProb: currentResult?.confidence ?? 0,
      primarySpeakerScore: currentResult?.primarySpeakerScore ?? 0,
      echoProb: currentResult?.echoProbability ?? 0,
      noiseFloorDb: -50,
      diagnosticClass: currentResult?.diagnosticClass ?? 'UNKNOWN_NOISE',
      confidence: currentResult?.confidence ?? 0.5,
    };
  }
}
