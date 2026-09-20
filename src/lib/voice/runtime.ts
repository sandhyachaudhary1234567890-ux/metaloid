// VoiceRuntime: The Single Authoritative Real-Time Voice Runtime.
// Coordinates ASR, Dynamic Turn Taking, Speaker Consistency Gating,
// LLM Streaming, Semantic Speech Chunking, Deterministic Speech Rendering,
// Adaptive Lookahead TTS Prefetching, and Instant Barge-In.
//
// SINGLE SOURCE OF TRUTH — No competing state machines.

import { VoiceMachine } from './stateMachine';
import { EnergyVad } from './vad';
import { AcousticEngine } from './acousticEngine';
import { BackgroundClassifier } from './backgroundClassifier';
import { turnScore, type TurnReading } from './turnEngine';
import { SpeechChunker } from './speechChunker';
import { defaultSpeechRenderer } from './speechRenderer';
import { ConversationResponsePlanner, type VoicePlanDirective } from './responsePlanner';
import { TTSStreamController } from './ttsStream';
import { BargeInController } from './bargeIn';
import { StageLedger } from './telemetry';
import { summarizeLatency } from './latency';
import type {
  VoiceState,
  VoiceProfile,
  LatencyMarks,
  LatencyReport,
  SpeechChunk,
  SpeakerConsistency,
} from './types';

export interface VoiceRuntimeCallbacks {
  onState?: (state: VoiceState, prev: VoiceState) => void;
  onPartial?: (text: string) => void;
  onLevel?: (level: number) => void;
  onSpeaking?: (speaking: boolean, phrase: string) => void;
  onSpokenWord?: (info: { charIndex: number; text: string; phrase: string }) => void;
  onLatency?: (report: LatencyReport, marks: LatencyMarks) => void;
  onError?: (message: string) => void;
  onInterruptRequest?: () => void;
  onFinalTranscript?: (text: string, generation: number, directive: VoicePlanDirective) => void;
  onPreemptiveTranscript?: (text: string) => void;
}

export class VoiceRuntime {
  readonly machine = new VoiceMachine();
  private ledger = new StageLedger();
  private chunker = new SpeechChunker();
  private responsePlanner = new ConversationResponsePlanner();
  private ttsStream = new TTSStreamController();
  private bgClassifier = new BackgroundClassifier();
  private bargeIn: BargeInController;

  private vad: EnergyVad | null = null;
  private acoustic: AcousticEngine | null = null;
  private mic: MediaStream | null = null;
  private rec: unknown = null;

  private gen = 0;
  private turnId = '';
  private profile: VoiceProfile = {
    voiceId: null,
    lang: 'en-US',
    rate: 1,
    pitch: 1,
    energy: 0.85,
  };

  private marks: LatencyMarks = {};
  private cb: VoiceRuntimeCallbacks = {};
  private openFlag = false;
  private muted = false;
  private lastInterim = '';
  private lastChangeAt = 0;
  private lastVadEndAt = 0;
  private preemptiveFired = false;
  private recEpoch = 0;
  private restartTimer = 0;
  private finalizeTimer = 0;
  private pollTimer = 0;
  private lastStartAt = 0;
  private restartBackoff = 400;
  private holding = false;
  private utterFinalSeen = false;
  private vadThreshold: number | null = null;

  constructor(callbacks: VoiceRuntimeCallbacks = {}) {
    this.cb = callbacks;
    this.machine.subscribe((s, prev) => {
      this.cb.onState?.(s, prev);
    });

    this.bargeIn = new BargeInController({
      onDuck: (duck) => {
        if (duck) this.ttsStream.pause();
        else this.ttsStream.resume();
      },
      onInterrupt: (reason, detectedAt) => {
        this.executeBargeIn(reason, detectedAt);
      },
    });

    this.ttsStream.setCallbacks({
      onAudioStart: (chunk) => {
        if (this.chunker.getEmittedChunks()[0]?.id === chunk.id && !this.marks.audioStart) {
          this.marks.audioStart = performance.now();
        }
        this.machine.go('MODEL_SPEAKING');
        this.vad?.setModelSpeaking(true);
        this.acoustic?.setModelSpeaking(true);
        this.bgClassifier.setModelSpeaking(true);
        this.ledger.set('TTS', 'ok', 'audio streaming');
        this.ledger.set('PLAYBACK', 'active', chunk.spokenText.slice(0, 40));
        this.cb.onSpeaking?.(true, chunk.spokenText);
      },
      onWordBoundary: (charIndex, text, phrase) => {
        this.cb.onSpokenWord?.({ charIndex, text, phrase });
      },
      onChunkCompleted: (chunk) => {
        // Ready for next chunk
      },
      onStateChange: (isPlaying) => {
        if (!isPlaying && this.machine.getState() === 'MODEL_SPEAKING') {
          // Playback ended
        }
      },
    });
  }

  get generation(): number {
    return this.gen;
  }

  getState(): VoiceState {
    return this.machine.getState();
  }

  setProfile(p: Partial<VoiceProfile>) {
    this.profile = { ...this.profile, ...p };
  }

  setVadThreshold(v: number | null) {
    this.vadThreshold = v;
    this.acoustic?.setThresholdBase(v ?? 0.032);
    if (v !== null && this.vad) this.vad.setFloor(v);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.mic?.getAudioTracks().forEach((t) => {
      t.enabled = !m;
    });
    if (!this.openFlag) return;
    if (m) {
      try {
        (this.rec as { abort?: () => void } | null)?.abort?.();
      } catch { /* ignore */ }
    } else if (['LISTENING', 'USER_SPEAKING'].includes(this.machine.getState())) {
      this.startRecognition();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  // ==================== LIFECYCLE ====================

  async open(lang: string): Promise<void> {
    if (this.openFlag) return;
    this.profile.lang = lang;
    this.ledger.reset();
    this.preemptiveFired = false;
    this.lastChangeAt = performance.now();
    this.marks = { micStart: performance.now() };

    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      this.ledger.set('MIC', 'dead', e instanceof Error ? e.message.slice(0, 60) : 'denied');
      throw e;
    }

    this.ledger.set('MIC', 'ok', this.mic.getAudioTracks()[0]?.label?.slice(0, 40) || 'live');

    // Attach VAD
    this.vad = new EnergyVad(
      this.vadThreshold !== null ? { threshold: this.vadThreshold } : {},
      {
        onLevel: (l) => {
          this.cb.onLevel?.(l);
          this.handleTickLevel(l);
        },
        onSpeechStart: () => this.handleVadSpeechStart(),
        onSpeechEnd: (dur) => this.handleVadSpeechEnd(dur),
      }
    );
    await this.vad.attach(this.mic);

    // Attach Acoustic Engine & Background Classifier
    this.acoustic = new AcousticEngine(this.mic, {
      thresholdBase: this.vadThreshold ?? 0.032,
    });
    this.acoustic.start();

    this.openFlag = true;
    this.machine.go('LISTENING');
    this.startRecognition();

    // Periodic poll for chunk flushes and background telemetry
    this.pollTimer = window.setInterval(() => {
      if (!this.openFlag) return;
      const chunks = this.chunker.poll();
      for (const c of chunks) {
        this.ttsStream.enqueue(c, this.profile);
      }
      const a = this.acoustic?.snapshot();
      if (a && this.vad) {
        this.vad.setFloor(a.vadThreshold);
      }
    }, 150);
  }

  close() {
    this.openFlag = false;
    this.recEpoch++;
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.finalizeTimer);
    window.clearTimeout(this.restartTimer);

    try {
      (this.rec as { abort?: () => void } | null)?.abort?.();
    } catch { /* ignore */ }
    this.rec = null;

    this.vad?.detach();
    this.vad = null;

    this.acoustic?.stop();
    this.acoustic = null;

    if (this.mic) {
      this.mic.getTracks().forEach((t) => t.stop());
      this.mic = null;
    }

    this.ttsStream.cancel();
    this.chunker.reset();
    this.bargeIn.cancelCandidate();
    this.machine.reset('IDLE');
  }

  // ==================== ASR & TURN TAKING ====================

  private startRecognition() {
    if (!this.openFlag || this.muted) return;
    window.clearTimeout(this.restartTimer);

    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
      | (new () => {
          continuous: boolean;
          interimResults: boolean;
          lang: string;
          onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
          onerror: ((e: { error: string }) => void) | null;
          onend: (() => void) | null;
          start: () => void;
          stop: () => void;
          abort: () => void;
        })
      | undefined;

    if (!Ctor) {
      this.machine.go('ERROR');
      this.cb.onError?.('Speech recognition is unavailable in this browser.');
      return;
    }

    try {
      (this.rec as { abort?: () => void } | null)?.abort?.();
    } catch { /* ignore */ }

    const epoch = ++this.recEpoch;
    const rec = new Ctor();
    this.rec = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.profile.lang;

    rec.onresult = (e) => {
      if (epoch !== this.recEpoch || !this.openFlag) return;
      this.restartBackoff = 400;

      let interim = '';
      let finals = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript || '';
        if (r.isFinal) finals += t;
        else interim += t;
      }

      if (interim.trim()) {
        this.ingestInterim(interim.trim());
      }
      if (finals.trim()) {
        this.marks.sttFinal = performance.now();
        this.utterFinalSeen = true;
        this.preemptiveFired = false;
        window.clearTimeout(this.finalizeTimer);
        this.ledger.set('STT', 'ok', `final: ${finals.trim().slice(0, 40)}`);
        this.handleFinalTranscript(finals.trim());
      }
    };

    rec.onerror = (e) => {
      if (epoch !== this.recEpoch) return;
      if (e.error === 'aborted') return;
      this.ledger.set('STT', 'dead', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.machine.go('ERROR');
        this.cb.onError?.('Microphone access blocked.');
        return;
      }
      if (this.openFlag && !this.muted) {
        this.machine.go('RECOVERING');
        this.scheduleRestart(900);
      }
    };

    rec.onend = () => {
      if (epoch !== this.recEpoch || !this.openFlag || this.muted) return;
      // Fallback: If utterance ended without final transcript, flush the buffered interim
      if (!this.utterFinalSeen && this.lastInterim.trim() && this.machine.getState() === 'USER_SPEAKING') {
        const text = this.lastInterim.trim();
        this.utterFinalSeen = true;
        this.marks.sttFinal = performance.now();
        this.ledger.set('STT', 'ok', `onend fallback: ${text.slice(0, 40)}`);
        this.handleFinalTranscript(text);
      }
      this.scheduleRestart(400);
    };

    try {
      rec.start();
      this.lastStartAt = performance.now();
    } catch {
      this.scheduleRestart(600);
    }
  }

  private scheduleRestart(delayMs: number) {
    window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => {
      if (!this.openFlag || this.muted) return;
      if (this.machine.getState() === 'RECOVERING') this.machine.go('LISTENING');
      this.startRecognition();
    }, delayMs);
  }

  ingestInterim(text: string) {
    const clean = text.trim();
    if (!clean || !this.openFlag) return;

    if (!this.marks.sttPartial) this.marks.sttPartial = performance.now();
    this.ledger.set('STT', 'active', clean.slice(0, 50));
    this.cb.onPartial?.(clean);

    const now = performance.now();
    if (clean !== this.lastInterim) {
      this.lastInterim = clean;
      this.lastChangeAt = now;
    }

    // Fast path: check for conversational interruption keywords in partial text
    if (['MODEL_SPEAKING', 'PROCESSING'].includes(this.machine.getState())) {
      const isKeywordInterrupt = this.bargeIn.evaluateTranscript(clean);
      if (isKeywordInterrupt) return;
    }

    // Evaluate Dynamic Endpointing
    const reading = turnScore({
      text: clean,
      silenceMs: this.vad?.isSpeaking() ? 0 : now - this.lastVadEndAt,
      stableMs: now - this.lastChangeAt,
      acoustic: this.acoustic
        ? { snrDb: this.acoustic.snapshot().snrDb, speechProb: this.acoustic.snapshot().speechProb }
        : undefined,
    });

    this.ledger.set(
      'TURN',
      reading.hypothesis === 'complete' ? 'ok' : reading.hypothesis === 'maybe' ? 'active' : 'idle',
      `${reading.hypothesis} (${reading.score.toFixed(2)}) · ${reading.reasons[0] || ''}`
    );

    const st = this.machine.getState();
    // Speculative preemptive trigger when complete thought is recognized
    if (
      !this.preemptiveFired &&
      reading.hypothesis === 'complete' &&
      clean.length >= 8 &&
      (st === 'LISTENING' || st === 'USER_SPEAKING' || st === 'TURN_CANDIDATE')
    ) {
      this.preemptiveFired = true;
      this.cb.onPreemptiveTranscript?.(clean);
    }
  }

  private handleFinalTranscript(text: string) {
    if (!this.openFlag) return;

    const st = this.machine.getState();
    if (st === 'MODEL_SPEAKING' || st === 'PROCESSING') {
      this.executeBargeIn('final_transcript_interrupt', performance.now());
    }

    this.lastInterim = '';
    this.preemptiveFired = false;
    this.cb.onPartial?.('');

    // Advance generation & turn token
    this.gen++;
    this.turnId = `turn_${Date.now()}_${this.gen}`;

    this.machine.go('PROCESSING');
    this.chunker.reset(this.turnId, this.gen);
    this.ttsStream.adopt(this.gen, this.turnId);
    this.responsePlanner.reset();

    // Direct turn execution via ConversationResponsePlanner
    const directive = this.responsePlanner.planTurn(text);

    // If fast acknowledgement is prescribed for expensive research, synthesize immediately
    if (directive.fastAcknowledgement) {
      const ackChunk: SpeechChunk = {
        id: `ack_${Date.now()}`,
        text: directive.fastAcknowledgement,
        spokenText: directive.fastAcknowledgement,
        semanticComplete: true,
        grammaticalComplete: true,
        stable: true,
        confidence: 1.0,
        sourceGenerationId: this.gen,
        turnId: this.turnId,
        status: 'READY',
      };
      this.ttsStream.enqueue(ackChunk, this.profile);
    }

    this.cb.onFinalTranscript?.(text, this.gen, directive);
  }

  // ==================== STREAMED GENERATION & TTS ====================

  /**
   * Feed streaming LLM tokens into the semantic chunker.
   * As soon as a complete semantic thought is ready, it is enqueued for TTS immediately.
   */
  feedTokens(generation: number, fullText: string) {
    if (!this.openFlag || generation !== this.gen) return;

    if (!this.marks.llmFirst) {
      this.marks.llmFirst = performance.now();
      this.ledger.set('LLM', 'active', 'tokens streaming');
    }

    // Plan voice vs chat separation
    const { voiceText } = this.responsePlanner.separateVoiceAndChat(fullText);

    // Push into semantic speech chunker
    const readyChunks = this.chunker.push(voiceText);

    for (const chunk of readyChunks) {
      if (!this.marks.firstChunkReady) {
        this.marks.firstChunkReady = performance.now();
      }
      // Check for repetition
      if (!this.responsePlanner.isDuplicateThought(chunk.text)) {
        this.ttsStream.enqueue(chunk, this.profile);
      }
    }
  }

  /**
   * Complete LLM stream for this generation.
   */
  async endTokens(generation: number, ok = true): Promise<void> {
    if (!this.openFlag || generation !== this.gen) return;

    this.ledger.set('LLM', ok ? 'ok' : 'dead', ok ? 'stream complete' : 'failed');

    // Flush any remaining thought chunks
    const finalChunks = this.chunker.finish();
    for (const chunk of finalChunks) {
      if (!this.responsePlanner.isDuplicateThought(chunk.text)) {
        this.ttsStream.enqueue(chunk, this.profile);
      }
    }

    // Await audio drain for this generation
    await this.ttsStream.drain(generation, this.profile);

    if (this.openFlag && generation === this.gen) {
      this.marks.turnEnd = performance.now();
      this.vad?.setModelSpeaking(false);
      this.acoustic?.setModelSpeaking(false);
      this.bgClassifier.setModelSpeaking(false);
      this.ledger.set('PLAYBACK', 'ok', 'completed');
      this.machine.go('LISTENING');
      this.emitLatency();
      this.startRecognition();
    }
  }

  // ==================== VAD & BARGE-IN ====================

  private handleVadSpeechStart() {
    if (!this.openFlag) return;
    const st = this.machine.getState();

    if (st === 'LISTENING') {
      this.machine.go('USER_SPEAKING');
      this.utterFinalSeen = false;
      this.ledger.set('VAD', 'active', 'speech start');
      if (!this.marks.speechStart) this.marks.speechStart = performance.now();
    } else if (st === 'MODEL_SPEAKING' || st === 'PROCESSING') {
      // Audio candidate for barge-in
    }
  }

  private handleVadSpeechEnd(dur: number) {
    if (!this.openFlag) return;
    this.lastVadEndAt = performance.now();
    if (!this.marks.speechEnd) this.marks.speechEnd = this.lastVadEndAt;
    this.ledger.set('VAD', 'ok', 'quiet');

    const st = this.machine.getState();
    if (st !== 'USER_SPEAKING') return;

    // Nudge recognizer to flush final if needed, or fallback flush if silence persists
    if (!this.utterFinalSeen && this.lastInterim && !this.holding) {
      window.clearTimeout(this.finalizeTimer);
      this.finalizeTimer = window.setTimeout(() => {
        if (!this.openFlag || this.utterFinalSeen) return;
        if (this.lastInterim.trim()) {
          const text = this.lastInterim.trim();
          this.utterFinalSeen = true;
          this.marks.sttFinal = performance.now();
          this.ledger.set('STT', 'ok', `silence fallback: ${text.slice(0, 40)}`);
          this.handleFinalTranscript(text);
          return;
        }
        try {
          (this.rec as { stop?: () => void } | null)?.stop?.();
        } catch { /* ignore */ }
      }, 950);
    }
  }

  private handleTickLevel(level: number) {
    const st = this.machine.getState();
    if (st !== 'MODEL_SPEAKING' && st !== 'PROCESSING') return;

    // Evaluate 2-tier Speaker Consistency Gate for barge-in
    if (this.acoustic) {
      const snap = this.acoustic.snapshot();
      // Heuristic acoustic features
      const features = {
        rms: level / 6,
        peak: level / 4,
        dbfs: snap.dbfs,
        zcr: 0.15,
        centroid: 1500,
        rolloff: 2500,
        flatness: 0.2,
        bandLow: 0.2,
        bandMid: 0.6,
        bandHigh: 0.2,
        hum: 0.01,
        crestDb: 10,
      };
      const gateResult = this.bgClassifier.evaluate(features, {
        floorDb: snap.noiseFloorDb,
        variance01: 0.3,
      });

      const speechHeldMs = this.vad?.speechHeldMs() || 0;
      this.bargeIn.evaluateAcoustics(speechHeldMs, gateResult);
    }
  }

  private executeBargeIn(reason: string, detectedAt: number) {
    if (!this.openFlag) return;
    const st = this.machine.getState();
    if (!['MODEL_SPEAKING', 'PROCESSING', 'USER_SPEAKING'].includes(st)) return;

    this.marks.interruptDetected = detectedAt;
    this.machine.go('USER_INTERRUPT');

    // Atomic stop
    this.ttsStream.cancel();
    this.chunker.reset();
    this.ttsStream.noteUserInterruption();
    this.cb.onInterruptRequest?.();

    this.vad?.setModelSpeaking(false);
    this.acoustic?.setModelSpeaking(false);
    this.bgClassifier.setModelSpeaking(false);
    this.cb.onSpeaking?.(false, '');

    const stoppedAt = performance.now();
    this.marks.audioStopped = stoppedAt;
    const bargeInLatency = Math.round(stoppedAt - detectedAt);
    this.bargeIn.recordLatency(bargeInLatency);

    this.ledger.set('TTS', 'idle', 'interrupted');
    this.ledger.set('PLAYBACK', 'idle', 'purged');

    this.machine.go('CANCELLING');
    this.machine.go('LISTENING');
    this.emitLatency();
    this.startRecognition();
  }

  stopSpeaking() {
    this.executeBargeIn('manual_stop', performance.now());
  }

  holdTalk(holding: boolean) {
    if (!this.openFlag) return;
    if (holding) {
      const st = this.machine.getState();
      if (st === 'MODEL_SPEAKING' || st === 'PROCESSING') {
        this.executeBargeIn('manual_hold', performance.now());
      }
      this.holding = true;
      if (this.machine.getState() === 'LISTENING') {
        this.machine.go('USER_SPEAKING');
        this.utterFinalSeen = false;
        this.startRecognition();
      }
    } else {
      this.holding = false;
      try {
        (this.rec as { stop?: () => void } | null)?.stop?.();
      } catch { /* ignore */ }
    }
  }

  // ==================== TELEMETRY & DEBUG ====================

  private emitLatency() {
    try {
      this.cb.onLatency?.(summarizeLatency(this.marks), { ...this.marks });
    } catch { /* isolated */ }
  }

  getSpeakerConsistency(): SpeakerConsistency {
    return this.bgClassifier.snapshot();
  }

  /** Start a model generation; invalidates older work. */
  newTurn(): number {
    this.gen++;
    this.turnId = `turn_${Date.now()}_${this.gen}`;
    this.chunker.reset(this.turnId, this.gen);
    this.ttsStream.adopt(this.gen, this.turnId);
    return this.gen;
  }

  /** Output-chain test without mic/STT. */
  testSpeaker(): number {
    const gen = this.newTurn();
    this.machine.go('PROCESSING');
    this.feedTokens(gen, 'Voice check. If you can hear this, my speaker works.');
    void this.endTokens(gen);
    return gen;
  }

  exportIncidents(): string {
    return this.acoustic?.exportIncidents() ?? '{"incidents":[]}';
  }

  debug() {
    const tracks = this.mic?.getAudioTracks() ?? [];
    const t = tracks[0];
    const snap = this.acoustic?.snapshot() ?? null;
    const bargeMetrics = this.bargeIn.getMetrics();

    return {
      state: this.machine.getState(),
      generation: this.gen,
      turnId: this.turnId,
      lang: this.profile.lang,
      peak: 0,
      recentPeak: 0,
      sr: 'started',
      srError: '',
      restarts: 0,
      interrupts: bargeMetrics.sampleCount,
      micTracks: tracks.length,
      micLive: !!t && t.readyState === 'live',
      micEnabled: !!t && t.enabled,
      micMuted: !!t && t.muted,
      micLabel: (t?.label || '').slice(0, 48),
      micId: t?.id || '',
      opens: 1,
      closes: 0,
      tts: true,
      stages: this.ledger.snapshot(),
      marks: { ...this.marks },
      pending: this.ttsStream.getPendingCount(),
      pendingChunks: this.ttsStream.getPendingCount(),
      activeChunk: this.ttsStream.getActiveChunk()?.text || '',
      lookaheadLimit: this.ttsStream.getMaxLookahead(),
      speakerConsistency: this.getSpeakerConsistency(),
      bargeInMetrics: bargeMetrics,
      transitions: this.machine.history().slice(-8).map((h) => `${h.from}→${h.to}`),
      acoustic: snap ? { snap, constraints: { aec: true, ns: true, agc: true, sampleRate: 16000, channels: 1, latencyMs: 10, label: t?.label || '' } } : null,
    };
  }
}
