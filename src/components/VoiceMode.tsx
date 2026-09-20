import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, MicOff, Video, X, Square, Activity, ChevronDown, Stethoscope, Hand, Gauge } from 'lucide-react';
import { confirmOverlap } from '../lib/voice/turnEngine';
import { useApp } from '../lib/store';
import { MetaloidCore } from './MetaloidCore';
import { VoiceVisualizer } from './VoiceVisualizer';
import { MetaIoidLockup } from './brand';
import { RealtimeSession, detectSupport } from '../lib/voice/session';
import { VAD_SENSITIVITY } from '../lib/voice/vad';
import { STATE_LABEL } from '../lib/voice/stateMachine';
import { bcp47 } from '../lib/voice/speech';
import { formatLatency } from '../lib/voice/latency';
import type { AgentStatus } from '../lib/types';
import type { VoiceState } from '../lib/voice/types';
import type { LatencyReport } from '../lib/voice/types';
import { cn } from '../lib/cn';

// Voice (§11): the realtime loop made visible — core, state, waveform,
// stop, camera shortcut, close. Turns persist to history; interrupt any time.

const ORB_STATUS: Record<VoiceState, AgentStatus> = {
  IDLE: 'idle',
  LISTENING: 'listening',
  USER_SPEAKING: 'listening',
  TURN_CANDIDATE: 'listening',
  PROCESSING: 'thinking',
  MODEL_SPEAKING: 'speaking',
  USER_INTERRUPT: 'listening',
  CANCELLING: 'thinking',
  RECOVERING: 'thinking',
  ERROR: 'error',
};

export function VoiceMode() {
  const {
    voiceOpen, setVoiceOpen, setStatus, settings, setView,
    runVoiceTurn, stopVoiceTurn, speculativeTurn, stopSpeculative,
    commitSpeculativeTurn, toast, detectedLang, connection,
  } = useApp();
  const [vState, setVState] = useState<VoiceState>('IDLE');
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [partial, setPartial] = useState('');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [spoken, setSpoken] = useState('');
  const [latency, setLatency] = useState<LatencyReport | null>(null);
  const [showLatency, setShowLatency] = useState(false);
  const [fatal, setFatal] = useState('');
  const [showCheck, setShowCheck] = useState(false);
  const [showPipe, setShowPipe] = useState(false);
  const [holding, setHolding] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [dbg, setDbg] = useState<ReturnType<RealtimeSession['debug']> | null>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const openedAt = useRef(Date.now());
  const connRef = useRef(connection);
  connRef.current = connection;
  // preemptive buffer: speculative reply for the guess, committed on confirm
  const preRef = useRef<{ text: string; full: string } | null>(null);
  const runRef = useRef({ runVoiceTurn, stopVoiceTurn, speculativeTurn, stopSpeculative, commitSpeculativeTurn });
  runRef.current = { runVoiceTurn, stopVoiceTurn, speculativeTurn, stopSpeculative, commitSpeculativeTurn };

  useEffect(() => {
    if (!voiceOpen) return;
    const sup = detectSupport();
    if (!sup.mic) {
      setFatal('This browser cannot capture microphone audio. Use Chrome or Edge on HTTPS/localhost.');
      return;
    }
    if (!sup.stt) {
      setFatal('Live transcription needs Chrome or Edge. Your words cannot be heard here — type in chat instead.');
      return;
    }
    setFatal('');
    setReply('');
    setHeard('');
    setPartial('');
    setSpoken('');
    setLatency(null);
    setDbg(null);
    setHolding(false);
    openedAt.current = Date.now();

    const session = new RealtimeSession({
      onState: (s) => {
        setVState(s);
        setStatus(ORB_STATUS[s]);
      },
      onPartial: (t) => setPartial(t),
      onLevel: (l) => setMicLevel(l),
      onSpokenWord: ({ phrase }) => setSpoken(phrase),
      onSpeaking: (speaking, phrase) => {
        if (speaking) setSpoken(phrase);
      },
      onLatency: (report) => setLatency(report),
      onError: (msg) => {
        setFatal(msg);
        toast({ title: 'Voice issue', desc: msg });
      },
      onInterruptRequest: () => {
        preRef.current = null;
        runRef.current.stopVoiceTurn();
        runRef.current.stopSpeculative();
      },
      // preemptive generation: guess is stable+complete, start the model
      // early (online only — free models make the extra call cheap).
      // Committed only if the final transcript confirms the guess.
      onPreemptiveTranscript: (guess) => {
        if (connRef.current !== 'online' || guess.trim().length < 10) return;
        runRef.current.stopSpeculative();
        const slot: { text: string; full: string } = { text: guess, full: '' };
        preRef.current = slot;
        const { promise } = runRef.current.speculativeTurn(guess, {
          onToken: (full) => {
            if (preRef.current === slot) slot.full = full;
          },
        });
        promise.catch(() => {
          if (preRef.current === slot) preRef.current = null;
        });
      },
      onFinalTranscript: async (text, generation) => {
        setHeard(text);
        setPartial('');
        setReply('');
        setSpoken('');
        setReplyError('');
        // preemptive commit: final confirms the guess → speak instantly
        const pre = preRef.current;
        preRef.current = null;
        runRef.current.stopSpeculative();
        if (pre && pre.full.trim() && confirmOverlap(pre.text, text) >= 0.6) {
          runRef.current.commitSpeculativeTurn(text, pre.full);
          setReply(pre.full);
          const s = sessionRef.current;
          if (s) {
            s.feedText(generation, pre.full);
            s.endText(generation, true);
          }
          return;
        }
        try {
          await runRef.current.runVoiceTurn(text, {
            onToken: (full) => {
              setReply(full);
              sessionRef.current?.feedText(generation, full);
            },
            onDone: (full) => {
              if (full) {
                setReply(full);
                sessionRef.current?.endText(generation);
              } else {
                // LLM leg failed and already wrote a fallback line in chat —
                // say so HERE too, otherwise the panel just goes quiet.
                setReplyError('No reply came back. The fallback line is in chat — check the gateway (Settings → System) or say it again.');
                sessionRef.current?.endText(generation);
              }
            },
          });
        } catch {
          setReplyError('Voice turn crashed before sending. Reopen voice mode and try again.');
        }
      },
    });
    sessionRef.current = session;
    session.setVadThreshold(VAD_SENSITIVITY[settings.vadSensitivity] ?? null);
    // debug handle for automated/browser-console triage (no UI effect)
    (window as unknown as { __voiceSession?: RealtimeSession }).__voiceSession = session;
    const w = window as unknown as { __voiceMounts?: number };
    w.__voiceMounts = (w.__voiceMounts || 0) + 1;
    // Recognition language: explicit setting wins; AUTO starts at en-IN
    // (best for Hinglish mix) and follows to hi-IN once Hindi is detected.
    const dl = detectedLang;
    const baseLang = settings.defaultLanguage === 'auto' ? 'auto' : settings.defaultLanguage;
    const recogLang =
      baseLang === 'auto' ? (dl === 'Hindi' ? 'hi-IN' : 'en-IN') : bcp47(baseLang);
    const lang = recogLang;
    session.setProfile({
      lang,
      rate: settings.speed,
      voiceId: lang.startsWith('hi') ? settings.hindiVoice : settings.englishVoice,
    });
    session.open(lang).catch((e: unknown) => {
      setFatal(e instanceof Error ? e.message : 'Could not start the microphone.');
      setStatus('idle');
    });
    const dbgTimer = window.setInterval(() => {
      const s = sessionRef.current;
      if (s) setDbg(s.debug());
    }, 700);
    return () => {
      window.clearInterval(dbgTimer);
      preRef.current = null;
      runRef.current.stopVoiceTurn();
      runRef.current.stopSpeculative();
      session.close();
      sessionRef.current = null;
      setStatus('idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOpen]);

  if (!voiceOpen) return null;

  const orb: AgentStatus = ORB_STATUS[vState];
  const label = STATE_LABEL[vState];
  const activeWave = vState === 'USER_SPEAKING' || vState === 'MODEL_SPEAKING';
  const micGone = !!dbg && (dbg.micTracks === 0 || !dbg.micLive);
  const silentAlarm =
    !fatal && dbg && Date.now() - openedAt.current > 8000 && !muted &&
    (dbg.recentPeak < 1 || dbg.micMuted || micGone);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
    toast({ title: next ? 'Microphone muted' : 'Microphone live' });
  };

  const stop = () => sessionRef.current?.stopSpeaking();

  const hold = (on: boolean) => {
    if (on && muted) {
      toast({ title: 'Unmute first', desc: 'The mic is muted' });
      return;
    }
    setHolding(on);
    sessionRef.current?.holdTalk(on);
  };

  const exit = () => {
    setVoiceOpen(false);
    setVState('IDLE');
  };

  return (
    <motion.div
      className="fixed inset-0 z-[70] bg-[var(--bg)]/98 backdrop-blur-2xl flex flex-col text-[var(--fg)]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal="true" aria-label="Voice mode"
    >
      <div className="flex items-center justify-between px-5 sm:px-8 h-16 border-b border-[var(--border)]">
        <MetaIoidLockup variant="live" size="sm" statusText="VOICE LIVE" />
        <button onClick={exit} className="icon-btn w-10 h-10" aria-label="Exit voice mode">
          <X size={20} />
        </button>
      </div>

      {fatal ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <MetaloidCore status="error" size={140} />
          <h2 className="mt-6 text-[18px] font-bold">Voice unavailable here</h2>
          <p className="mt-2 text-[14px] text-zinc-400 max-w-[420px]">{fatal}</p>
          <button onClick={() => { exit(); setView('chat'); }} className="btn-primary h-11 px-6 text-[14px] mt-6">
            Continue in chat
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center overflow-y-auto py-6">
          <MetaloidCore status={orb} size={180} />
          <h2 className="mt-5 text-[22px] font-bold tracking-tight text-[var(--fg)]" aria-live="polite">{muted ? 'Muted' : label}</h2>
          <p className="text-[13px] text-[var(--fg-muted)] mt-1.5">
            {settings.defaultLanguage === 'hi' ? 'बोलिए — बीच में रोक सकते हैं' : 'Speak — interrupt me any time'}
          </p>

          <div className="mt-4 w-full max-w-[440px]">
            <VoiceVisualizer
              active={activeWave || vState === 'LISTENING'}
              color={vState === 'USER_SPEAKING' ? 'emerald' : 'indigo'}
              level={vState === 'MODEL_SPEAKING' || muted ? undefined : micLevel}
            />
            <p className="mt-1 text-[11.5px] text-[var(--fg-subtle)]">
              {vState === 'USER_SPEAKING' ? 'Hearing you — dynamic audio level' : 'Acoustic waveform mirrors your live mic input'}
            </p>
          </div>

          {/* silence alarm */}
          <AnimatePresence>
            {silentAlarm && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-3 max-w-[480px] w-full rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-5 py-3.5 text-left" role="alert">
                <p className="text-[13.5px] font-semibold text-amber-300">
                  {micGone ? 'Microphone disconnected' : dbg?.micMuted ? 'Microphone muted by the system' : 'Microphone is silent'}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                  {micGone
                    ? 'The mic track ended. Close and reopen voice mode.'
                    : dbg?.micMuted
                      ? 'Your OS muted the input (not this app). Unmute the mic in Windows sound settings.'
                      : 'Zero audio is arriving. Check privacy settings and verify microphone access.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* live transcript (interim) */}
          <AnimatePresence>
            {(partial || heard) && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-3 max-w-[480px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-5 py-3.5 text-left">
                {heard && <p className="text-[14px] text-[var(--fg)]">“{heard}”</p>}
                {partial && <p className="text-[14px] text-[var(--fg-muted)] italic mt-1">{partial}…</p>}
              </motion.div>
            )}
          </AnimatePresence>

          {/* spoken reply with current-phrase highlight */}
          <AnimatePresence>
            {reply && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-2.5 max-w-[480px] w-full rounded-2xl border border-[var(--accent)] bg-[var(--accent-subtle)] px-5 py-3.5 text-left">
                <SpokenText full={reply} current={spoken} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* audible failure — never go silently quiet */}
          <AnimatePresence>
            {replyError && !reply && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-2.5 max-w-[480px] w-full rounded-2xl border border-red-500/25 bg-red-500/[0.07] px-5 py-3.5 text-left" role="alert">
                <p className="text-[13.5px] text-red-200">{replyError}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* measured latency — never claimed, always shown */}
          <div className="mt-4">
            <button
              onClick={() => setShowLatency((s) => !s)}
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
              aria-expanded={showLatency}
            >
              <Activity size={13} /> {latency ? formatLatency(latency) : 'latency appears after a turn'}
              <ChevronDown size={13} className={cn('transition-transform', showLatency && 'rotate-180')} />
            </button>
            {showLatency && (
              <p className="mt-1.5 text-[11.5px] text-[var(--fg-muted)] max-w-[420px]">
                Measured on-device timings for this session. Barge-in counts speech-detect → audio-stop.
              </p>
            )}
          </div>

          {/* pipeline telemetry — the 8-point layer readout */}
          <div className="mt-2.5">
            <button
              onClick={() => setShowPipe((s) => !s)}
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
              aria-expanded={showPipe}
            >
              <Gauge size={13} /> Pipeline
              <ChevronDown size={13} className={cn('transition-transform', showPipe && 'rotate-180')} />
            </button>
            {showPipe && (
              <div className="mt-2 w-full max-w-[440px] rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3">
                {!dbg ? (
                  <p className="text-[12.5px] text-[var(--fg-muted)]">Starting session…</p>
                ) : (
                  <ul className="space-y-1.5">
                    {(['MIC', 'VAD', 'STT', 'TURN', 'LLM', 'TTS', 'PLAYBACK'] as const).map((id) => {
                      const st = dbg.stages[id];
                      return (
                        <li key={id} className="flex items-center gap-2.5 text-[12px]">
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full shrink-0',
                              st.status === 'ok' && 'bg-emerald-400',
                              st.status === 'active' && 'bg-[var(--accent)] animate-pulse',
                              st.status === 'dead' && 'bg-red-400',
                              st.status === 'idle' && 'bg-[var(--fg-subtle)]'
                            )}
                          />
                          <span className="font-mono font-semibold text-[var(--fg)] w-[70px] shrink-0">{id}</span>
                          <span className="truncate text-[var(--fg-muted)]">{st.detail}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-[var(--fg-muted)]">Dead layer = exact fault location. Green = flowing.</p>
                {dbg?.acoustic && <AcousticBlock dbg={dbg} />}
              </div>
            )}
          </div>

          {/* mic check — ground truth when hearing fails */}
          <div className="mt-2.5">
            <button
              onClick={() => setShowCheck((s) => !s)}
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
              aria-expanded={showCheck}
            >
              <Stethoscope size={13} /> Mic check
              <ChevronDown size={13} className={cn('transition-transform', showCheck && 'rotate-180')} />
            </button>
            {showCheck && (
              <div className="mt-2 w-full max-w-[440px] rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-left">
                {!dbg ? (
                  <p className="text-[12.5px] text-[var(--fg-muted)]">Starting session…</p>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                    <CheckRow k="Mic track" v={dbg.micTracks === 0 ? 'none!' : dbg.micLive ? 'live' : 'ended!'} bad={dbg.micTracks === 0 || !dbg.micLive} />
                    <CheckRow k="Mic enabled" v={dbg.micEnabled ? (dbg.micMuted ? 'muted!' : 'yes') : 'off!'} bad={!dbg.micEnabled || dbg.micMuted} />
                    <CheckRow k="Peak level" v={`${dbg.peak}% (3s: ${dbg.recentPeak}%)${dbg.recentPeak < 1 ? ' — silent!' : ''}`} bad={dbg.recentPeak < 1} />
                    <CheckRow k="Recognizer" v={dbg.sr + (dbg.srError ? `: ${dbg.srError}` : '')} bad={dbg.sr === 'error' || dbg.sr === 'start-failed'} />
                    <CheckRow k="Speech out" v={dbg.tts ? 'available' : 'unavailable!'} bad={!dbg.tts} />
                    <CheckRow k="Language" v={dbg.lang} />
                    <CheckRow k="State" v={`${vState} · gen ${dbg.generation}`} />
                  </dl>
                )}
                {dbg?.micLabel ? <p className="mt-1.5 text-[11px] text-[var(--fg-muted)] truncate">Input: {dbg.micLabel}</p> : null}
                <p className="mt-1.5 text-[11px] text-[var(--fg-muted)]">Speak while watching Peak — healthy speech reads 3–60%. Stuck at 0% means the OS/browser gives us silence.</p>
                {dbg?.acoustic && (
                  <p className="mt-1.5 text-[11px] text-[var(--fg-muted)] font-mono">
                    AEC:{String(dbg.acoustic.constraints.aec)} NS:{String(dbg.acoustic.constraints.ns)} AGC:{String(dbg.acoustic.constraints.agc)}
                    {dbg.acoustic.constraints.sampleRate ? ` ${Math.round(dbg.acoustic.constraints.sampleRate / 100) / 10}kHz` : ''}
                    {dbg.acoustic.constraints.channels ? ` ${dbg.acoustic.constraints.channels}ch` : ''}
                    {' '}· applied, not requested
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => sessionRef.current?.testSpeaker()}
                    className="btn-ghost h-9 px-3 text-[12.5px] flex-1"
                  >
                    Test speaker
                  </button>
                  <button
                    onClick={() => {
                      const s = sessionRef.current?.exportIncidents();
                      if (!s) return;
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(new Blob([s], { type: 'application/json' }));
                      a.download = 'metaloid-voice-incidents.json';
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    className="btn-ghost h-9 px-3 text-[12.5px] flex-1"
                    title="Decision chain + acoustic events (no raw audio, dev only)"
                  >
                    Export incidents
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!fatal && (
        <div className="border-t border-[var(--border)] px-5 py-4 bg-[var(--bg)]" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {/* hold-to-talk: guaranteed path that bypasses auto-detection */}
          <div className="max-w-[560px] mx-auto mb-2.5">
            <button
              onPointerDown={(e) => { e.preventDefault(); hold(true); }}
              onPointerUp={() => hold(false)}
              onPointerLeave={() => { if (holding) hold(false); }}
              onPointerCancel={() => { if (holding) hold(false); }}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Hold to talk"
              style={{ touchAction: 'none' }}
              className={cn(
                'w-full h-12 rounded-xl border flex items-center justify-center gap-2.5 text-[13.5px] font-medium transition-all select-none',
                holding
                  ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] scale-[0.99]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--surface-hover)] active:scale-[0.99]'
              )}
            >
              <Hand size={16} /> {holding ? 'Release to send' : 'Hold to talk'}
            </button>
          </div>
          <div className="max-w-[560px] mx-auto flex items-center justify-center gap-2.5">
            <CtrlBtn label={muted ? 'Unmute microphone' : 'Mute microphone'} onClick={toggleMute} off={muted} Icon={muted ? MicOff : Mic} />
            <CtrlBtn label="Stop speaking (interrupt)" onClick={stop} Icon={Square} />
            <CtrlBtn label="Open camera (Live)" onClick={() => { exit(); setView('live'); }} Icon={Video} />
            <button
              onClick={() => { exit(); setView('chat'); }}
              className="h-[48px] rounded-xl bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--fg)] flex items-center px-4 text-[13.5px] font-medium transition-all"
            >
              View chat
            </button>
            <CtrlBtn label="Exit voice mode" onClick={exit} danger Icon={X} />
          </div>
        </div>
      )}
    </motion.div>
  );
}

function SpokenText({ full, current }: { full: string; current: string }) {
  if (!current) return <p className="text-[14px] leading-relaxed text-[var(--fg)]">{full}</p>;
  const i = full.indexOf(current);
  if (i < 0) return <p className="text-[14px] leading-relaxed text-[var(--fg)]">{full}</p>;
  return (
    <p className="text-[14px] leading-relaxed text-[var(--fg-muted)]" aria-live="polite">
      {full.slice(0, i)}
      <span className="text-[var(--fg)] bg-[var(--accent-subtle)] rounded px-0.5">{current}</span>
      {full.slice(i + current.length)}
    </p>
  );
}

type Dbg = NonNullable<ReturnType<RealtimeSession['debug']>>;

function AcousticBlock({ dbg }: { dbg: Dbg }) {
  const a = dbg.acoustic;
  if (!a) return null;
  const s = a.snap;
  if (!s) return null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const on = (b: boolean) => (b ? 'text-[var(--accent)]' : 'text-[var(--fg-muted)]');
  return (
    <div className="mt-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
      <div className="text-[10px] font-semibold tracking-[0.18em] text-[var(--fg-muted)] uppercase mb-1.5">ACOUSTICS</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">Noise floor</dt><dd className="font-mono text-[var(--fg)]">{s.noiseFloorDb.toFixed(0)} dBFS</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">SNR</dt><dd className="font-mono text-[var(--fg)]">{s.snrDb.toFixed(0)} dB{s.clipped ? ' CLIP!' : ''}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">Environment</dt><dd className="font-mono text-[var(--fg)]">{s.env}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">VAD floor</dt><dd className="font-mono text-[var(--fg-muted)]" title={s.vadReason}>{s.vadThreshold.toFixed(4)}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">Primary</dt><dd className={cn('font-mono', on(s.primaryProb > 0.5))}>{pct(s.primaryProb)}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">Echo</dt><dd className={cn('font-mono', s.echoProb > 0.5 ? 'text-amber-400' : 'text-[var(--fg-muted)]')}>{pct(s.echoProb)}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">Music</dt><dd className={cn('font-mono', on(s.music))}>{s.music ? 'yes' : '—'}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">Bg speech</dt><dd className={cn('font-mono', on(s.backgroundSpeech))}>{s.backgroundSpeech ? 'yes' : '—'}</dd></div>
        {dbg.speakerConsistency && (
          <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">Sound gate</dt><dd className="font-mono text-[var(--accent)]">{dbg.speakerConsistency.diagnosticClass}</dd></div>
        )}
        {dbg.bargeInMetrics?.p95BargeInMs !== null && dbg.bargeInMetrics?.p95BargeInMs !== undefined && (
          <div className="flex items-center justify-between gap-2"><dt className="text-[var(--fg-muted)]">Barge p95</dt><dd className="font-mono text-emerald-400">{dbg.bargeInMetrics.p95BargeInMs}ms</dd></div>
        )}
      </dl>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
        <span className="text-[var(--fg-muted)]">Buffer</span>
        <span className="font-mono text-[var(--fg-muted)]">{dbg.pending} chunks · lookahead {dbg.lookaheadLimit || 1}</span>
      </div>
      {s.recentEvents.length > 0 && (
        <p className="mt-1 text-[11px] font-mono text-[var(--fg-muted)] truncate" title={s.recentEvents.map((e) => e.type).join(', ')}>
          {s.recentEvents.slice(0, 3).map((e) => e.type).join(' → ')}
        </p>
      )}
    </div>
  );
}

function CheckRow({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <dt className="text-[var(--fg-muted)] shrink-0">{k}</dt>
      <dd className={cn('truncate font-mono', bad ? 'text-amber-400' : 'text-[var(--fg)]')}>{v}</dd>
    </div>
  );
}

function CtrlBtn({ label, onClick, Icon, off, danger }: { label: string; onClick: () => void; Icon: typeof Mic; off?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick} title={label} aria-label={label}
      className={cn(
        'w-[48px] h-[48px] min-w-[48px] rounded-xl border flex items-center justify-center transition-all active:scale-95',
        danger ? 'border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/20'
          : off ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--surface-hover)]'
      )}
    ><Icon size={18} /></button>
  );
}
