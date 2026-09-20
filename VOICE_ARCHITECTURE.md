# METALOID Realtime Voice Architecture v1.0

Status: **loop implemented** (`src/lib/voice/` + `VoiceMode` + `voice` model tier).
Transport/STT surface as specified below; socket upgrade is a reserved phase.

Principle: **TTFA first.** A slightly slower model with excellent streaming
feels faster than a fast model with slow audio. Every layer below exists to
shrink time-to-first-audio, protect barge-in, and never play stale sound.

---

## 1. Realtime architecture diagram

```
MIC ──► AUDIO CAPTURE (getUserMedia, EC+NS+AGC)
  ──► CLIENT VAD [EnergyVad] ──► SPEECH_START / SPEECH_END
  ──► STT [WebSpeech interim] ──► PARTIAL ──► FINAL (turn)
  ──► AGENT KERNEL (chat.runVoiceTurn, task:'voice', history+memory ctx)
  ──► LLM SSE STREAM (free-model router)
  ──► TOKEN BUFFER [AdaptiveSegmenter] ──► STABLE PHRASE
  ──► SPEECH DIRECTOR [sanitize + planSpeech] ──► SPEECH PLAN
  ──► TTS PROVIDER [SpeechSynthesisTTS, chunked] ──► UTTERANCE
  ──► AUDIO QUEUE [AudioQueue, gen-gated, bounded]
  ──► PLAYBACK (engine queue, gapless chain)
  ──► VAD hears user ──► BARGE-IN ──► cancel all ──► LISTENING
```

Nothing blocks on a full answer. Tokens → phrases → audio flow continuously
and in parallel from the first stable phrase.

## 2. Event / state machine

`src/lib/voice/stateMachine.ts` — the only owner of voice state:

```
IDLE → LISTENING ⇄ USER_SPEAKING → PROCESSING → MODEL_SPEAKING → LISTENING
                         PROCESSING ──► USER_INTERRUPT (barge-in mid-LLM)
            MODEL_SPEAKING ──► USER_INTERRUPT ──► CANCELLING ──► LISTENING
                                  any ──► ERROR ──► RECOVERING ──► LISTENING
```

Transitions are a checked table; illegal moves return false and are dropped.
UI subscribes; the global orb mirrors the same states.

## 3. Client architecture (`src/lib/voice/`)

| File | Owns |
|---|---|
| `types.ts` | VoiceState, turns, latency, VAD/segmenter configs, TTS capabilities + honest capability matrix |
| `stateMachine.ts` | VoiceMachine, transition table, labels |
| `vad.ts` | EnergyVad: RMS loop, hangover, echo-guard floor, level tap |
| `segmenter.ts` | AdaptiveSegmenter: cumulative-stream safe, word-safe, timeouts |
| `speech.ts` | sanitizeForSpeech, planSpeech (pauses), bcp47, TTS_CAPS |
| `tts.ts` | SpeechSynthesisTTS behind TTSProvider shape |
| `playback.ts` | AudioQueue: generation gate, bound, overflow-merge, pause/resume |
| `session.ts` | RealtimeSession: mic→VAD→STT→turn→feed→speak→barge-in |
| `latency.ts` | marks → TTFT/TTFA/barge-in/turn-end + formatter |

## 4. Server architecture

No voice-specific server yet (local loop). Gateway contributes:
`task:'voice'` → fast-tier routing + spoken-style system suffix
(1–3 sentences, conversational, no markdown). STT/TTS providers land here
in Phase 13 behind the same interfaces; session accepts a `socket`
transport without UI changes (reserved).

## 5. WebSocket/WebRTC architecture (reserved, Phase 12)

```
CLIENT (capture+VAD+playback) ↕ WS (binary PCM 20–40ms frames, JSON events)
↕ REALTIME GATEWAY (session, VAD-fusion, turn FSM)
↕ AI SESSION (LLM stream → segmenter → TTS) ↕ TOOLS/AGENTS
```

REST stays for settings/history/config. Session resumption replays
`mission context + conversation tail`, never raw audio.

## 6. VAD architecture

Hybrid-ready, client-first: `EnergyVad` (RMS, fftSize 1024, smoothing 0.35)
fires SPEECH_START on first crossing; SPEECH_END after 750ms silence with
≥180ms spoken (no clipped edges). While MODEL_SPEAKING the floor rises
0.045→0.11 RMS (echo guard); sustained 300ms+ energy = barge-in candidate.
Server VAD fuses later as a second signal; thresholds live in `VadConfig`.

## 7. STT architecture

WebSpeech (`SpeechRecognition`/`webkit`) continuous + interimResults.
Interim → `onPartial` UI + `sttPartial` mark. Final → turn (`sttFinal`).
Auto-restart on `onend` while the session lives; `no-speech`/`network` →
RECOVERING → restart. Unsupported (Firefox) → honest ERROR panel, no fake
transcription. Custom vocabulary: reserved (provider lacks it).

## 8. LLM streaming architecture

Existing gateway SSE reused verbatim (`task:'voice'`). Frontend
`runVoiceTurn` writes the same history as typed chat, passes history+memory
context, and forwards cumulative text to `session.feedText`. Abort on
barge-in via dedicated `voiceAbortRef` (typed-chat generation untouched).

## 9. Speech segmenter

`AdaptiveSegmenter`: min 24 / max 220 chars, punctuation-weighted flush,
long-clause comma splits, soft 900ms / hard 2400ms stall flush, trailing
partial word never emitted, cumulative-stream cursor (no re-emission).
Verified by execution: lossless, word-safe, ordered, ceiling-honored,
short-text waits (see build notes).

## 10. TTS streaming architecture

`TTSProvider` shape: `speak(plan, opts)` per stable segment, `cancel()`
(atomic), `pause()/resume()`, `pickVoice()`, `supported()`. Current:
speechSynthesis chunked fallback, declared `streaming:false, chunked:true`.
True-streaming providers implement the same five methods later.

## 11. Audio queue

`AudioQueue`: serial pump over pending plans, generation check at dequeue
AND at every engine callback, `MAX_PENDING=5` with tail-merge overflow,
`invalidate(gen)` + engine `cancel()` on barge-in, pause/resume passthrough.
`current()` exposes the sounding phrase for highlight/UI sync.

## 12. Playback engine

Engine-native utterance chaining (no per-chunk Audio elements), gapless by
construction, pause/resume, per-utterance volume hooks, `onboundary` word
events surfaced as `{charIndex, text, phrase}`. Underrun recovery =
RECOVERING → resume; PCM worklet path reserved for binary providers.

## 13. Interruption system

Two triggers: (a) VAD sustained energy during MODEL_SPEAKING/PROCESSING,
(b) SR final arriving mid-speech (semantic interrupt with transcript).
Both funnel to `session.interrupt()`: mark → USER_INTERRUPT → request LLM
abort → `queue.clear()` → reset segmenter → CANCELLING → LISTENING →
cooldown 500ms → recognition restart. Manual stop button = same path.

## 14. Cancellation propagation

UI stop → playback clear → TTS atomic cancel → `stopVoiceTurn()` aborts the
SSE fetch → mission/tool legs (when voice triggers them) share the abort
domain. One direction, one call chain, no orphans.

## 15. Generation ID system

`session.gen` increments per turn AND per interrupt; queue adopts only the
current gen; every TTS callback re-checks currency; `feedText`/`endText`
drop stale gens silently. Late audio from gen N can never sound under gen N+1.

## 16. Latency measurement

Marks: micStart/speechStart/speechEnd/sttPartial/sttFinal/llmFirst/segReady/
ttsStart/audioStart/interruptDetected/audioStopped/turnEnd. Reported per
turn in VoiceMode (`TTFT · TTFA · barge-in · turn-end`); nothing is claimed
without a measurement. Server-side legs join via `trackModel` (existing).

## 17. Provider abstraction

`STTProvider` (recognition lifecycle) · `TTSProvider` (speak/cancel/pause) ·
`VADProvider` (attach/levels) · `AudioTransport` (local | socket reserved) ·
`AudioPlaybackEngine` (utterance chain | worklet reserved). Capability matrix
in `types.ts:CAPABILITIES` — the doc and the code read the same table.

## 18. Voice configuration

`voiceId` (matched by name, else locale), `speed` (settings.speed → rate),
`pitch` 1.0, `energy` 0.82–0.9 by sentence type, `pauseStyle` from
punctuation map, `pronunciation` reserved, `language` bcp47(auto/hi/en+),
profiles: default/calm/fast/precise/warm/technical = rate+energy presets
(reserved; default ships).

## 19. UI state system

VoiceMode renders machine state only: core orb, label, waveform (user
energy while hearing, synthetic while speaking), interim + final transcript,
spoken reply with current-phrase highlight, latency disclosure, mic/stop/
camera/exit. Backchannels: LISTENING / HEARING / PROCESSING / SPEAKING /
INTERRUPTED / TOOL USE (via global status) / THINKING / COMPLETE.

## 20. Failure recovery

TTS unsupported → ERROR panel (no fake voice). Mic blocked → guidance.
SR network loss → RECOVERING loop. LLM fail → honest in-chat fallback line,
turn ends, machine LISTENING. Never stuck SPEAKING: every path resolves or
resets; `close()` releases mic tracks + clears queues unconditionally.

## 21. Reconnect/resume logic

Recognition auto-restarts; mic reacquired on reopen; conversation history
persists so context survives any reconnect; mission state untouched by voice
lifecycle. Socket era: resume = reattach + replay tail (specified §5).

## 22. Folder structure

```
src/lib/voice/{types,stateMachine,vad,segmenter,speech,tts,playback,session,latency}.ts
src/components/VoiceMode.tsx        # thin view over RealtimeSession
src/store/chat.tsx                  # runVoiceTurn/stopVoiceTurn (history-consistent)
server/src/index.js                 # task:'voice' tier + spoken-style suffix
```

## 23. TypeScript interfaces/types

See `types.ts` (VoiceState, VoiceTurn, LatencyMarks/Report, VadConfig,
SegmenterConfig, SpeechPlan, TtsCapabilities, VoiceProfile, CAPABILITIES).
Event schemas: `{type:'state',from,to}`, `{type:'partial',text}`,
`{type:'spoken-word',charIndex,text,phrase}`, `{type:'latency',report}`.

## 24. Sequence diagrams

Happy path:
`VAD_START → USER_SPEAKING → VAD_END → STT_FINAL → PROCESSING →
LLM_FIRST → SEG_READY → TTS_START → AUDIO_START → drain → LISTENING`
Barge-in:
`VAD energy 300ms @MODEL_SPEAKING → USER_INTERRUPT → LLM abort +
TTS cancel + queue.clear → CANCELLING → LISTENING (+transcript→new turn)`

## 25. Implementation roadmap (mapped to requested phases)

- ✅ P1 mic streaming · P2 VAD · P3 interim STT · P4 LLM stream ·
  P5 phrase TTS · P6 gapless queue · P7 barge-in · P8 cancellation ·
  P9 pauses/prosody · P10 word highlight · P15 agent integration
  (history-consistent turns, voice task tier)
- ✅ Turn engine (§27) · preemptive generation (§28) · pipeline
  telemetry (§29) · hold-to-talk fallback · mic-check diagnostics
- Reserved: P11 tool-aware speech (state chips exist; spoken tool
  narration pending), P12 socket sessions, P14 dashboard (per-turn
  readout + pipeline panel ship; aggregate surface pending).
  P13 done at gateway level: NVIDIA fallback covers smart + voice tiers.

## 26. Verification performed
- `tsc` clean; production build green.
- `AdaptiveSegmenter` executed against its compiled output: token-trickle
  input → exact phrase boundaries, lossless, word-safe, ordered,
  220-char ceiling, short-text hold, stall-poll (this doc's §9 claims
  are measured, not asserted).
- `turnScore` executed against its compiled output: 8/8 including
  Hinglish fillers ("aur phir mujhe ye" → incomplete), no-punctuation
  stability ("weather kaisa hai aaj" + pause → complete), empty-guard.
- **Torture rig** (`voicetest/torture.cjs`, rerunnable): 20 scripted tests
  against the real app in real Chrome — **20/20**, results in
  `voicetest/RESULTS.md`. TTFA-proxy min 165ms / median ~2s (headless
  includes voice-list waits); barge-in to LISTENING 1–9ms with genuine
  old-generation drops; zero false interrupts; zero page errors.
- Defects found by the rig and fixed (all re-verified):
  1. Recognition restart storm: 8,311 restarts/20s → ~25
     (single-flight restarts + epoch tokens + aborted-is-not-failure).
  2. Drain race: `turnEnd`/LISTENING fired while audio still played
     (drain awaited a busy pump) → true-drain wait.
  3. Duplicate emission on cumulative streams → stream cursor.
  4. Devanagari danda missing from sentence punctuation → Hindi replies
     never split (found by T04, fixed, re-proven speaking).
  5. Dead NVIDIA fallback (unentitled key) → gated off; try-next free
     slugs on 404/429 instead.
  6. Abort-every-POST-stream (`req.on('close')`) → `res.on('close').
- Standing rule, encoded in the rig: **infra-green (frontend 200,
  gateway healthy) never implies agent success.** Proof is only the
  MIC → TURN → LLM → TTS → PLAYBACK → INTERRUPTION → RECOVERY matrix.
  Headless limits are labeled in RESULTS.md, never hidden.
- Recognition restart storm found by scripted-browser harness
  (8,311 restarts/20s, finals destroyed as fast as they arrived):
  single-flight restarts + epoch tokens + aborted-is-not-failure.
  Re-measured clean (25/20s, zero errors).

## 27. Turn engine (SmartTurn-lite)

`src/lib/voice/turnEngine.ts` — silence VAD answers "speech vs quiet";
this answers "done vs pausing": score = silence(0.35) + syntax(0.35) +
stability(0.2) + length-fit(0.1). Fillers (EN + Hinglish) veto completion;
terminal punctuation, questions, and stable-speech-plus-long-pause confirm
it. Sessions score every interim into the TURN stage; finals confirm.
`confirmOverlap` gates preemptive commits (≥0.6 word overlap).

## 28. Preemptive generation

Stable + likely-complete interim (≥10 chars, LISTENING/USER_SPEAKING,
online only) starts a speculative `streamChat` whose tokens touch nothing.
On final: overlap ≥0.6 → `commitSpeculativeTurn` writes history and the
buffered reply feeds TTS instantly (perceived near-zero TTFA); on pivot or
interrupt → abort, normal turn. Barge-in aborts speculation first.

## 29. Pipeline telemetry

`src/lib/voice/telemetry.ts` (`StageLedger`) + VoiceMode Pipeline panel:
MIC · VAD · STT · TURN · LLM · TTS · PLAYBACK with idle/active/ok/dead +
detail text, polled live. The 8-point checklist from the design brief is
now a permanent UI surface — the next "not listening" report starts with
a screenshot of it, not guesswork.

## 30. Framework adoption map (LiveKit / Pipecat / Smart Turn)

Deliberate decision: TS-native runtime today, managed foundations as a
swap — not a second stack beside this one:
- Our `Frame`-shaped flow (transcript/text/speech/control traversals in
  `session.ts`) mirrors Pipecat processor pipelines; porting means
  implementing the same five methods against Pipecat processors.
- `turnEngine.ts` IS the Smart Turn seat: swap `turnScore` for the Smart
  Turn model call when a key exists; the hypothesis states don't change.
- `AudioTransport` (`local` today) is the LiveKit seat: WebRTC media +
  session manager plug in behind it; state machine, generations, and
  cancellation are transport-agnostic already.
- Not adopted yet (need keys/infra): LiveKit server/account, Gemini Live,
  Deepgram endpointing, server STT/TTS. Nothing in the current design
  blocks any of them.

## 31. Acoustic Intelligence Engine

Pure DSP core (`lib/voice/acoustics.ts`, DOM-free) + browser glue
(`acousticEngine.ts`, own analyser on the mic stream) + session integration.
Proven by execution: 14/14 on synthesized signals (silence, speech-like
harmonics, fan noise, knock transient, mains hum, chord music, ambiguous
tone honestly UNKNOWN, floor dynamics, threshold mapping, fusion trio,
environments). Live probe: real constraints read back
(AEC/NS/AGC on, 48kHz/1ch), floor adapted -54dB, VAD floor 0.032?0.015.

- Features/frame: RMS, peak, dBFS, ZCR, centroid, rolloff, flatness,
  low/mid/high band shares, 50/60Hz hum share, crest. FFT 2048 @~11fps.
- Classes: silence / speech / stationary-noise / music / hum / impact /
  unknown (never forced; confidences 0.4�0.9, no 0.99 theater).
- NoiseFloor: quiet-following floor, fast-attack signal, SNR, clip flag.
- Adaptive VAD: threshold = clamp(floor�3.2, echo�1.8, snr relief),
  delta-blended around the user sensitivity base (Low 0.05 / Med 0.032 /
  High 0.018), applied every 350ms tick.
- Barge-in fusion: speech�primary�(1-echo)�turn-gate; confirm =0.55,
  candidate =0.3 ? DUCK (pause output, reversible) ? 350ms evidence
  window ? confirm (interrupt) or resume. Transcript finals still
  interrupt instantly (strong evidence skips ducking).
- Turn integration: `turnScore(..., acoustic:{snrDb,speechProb})` adjusts,
  never decides. Pluggable seat kept for Smart Turn (`predictTurnState`
  shape matches the hypothesis states).
- Speaker model: primary-user likelihood from level-vs-baseline +
  continuity (honest heuristic, capped 0.92); background-speech latch on
  quiet sustained speech; echo estimate while model audio plays.
- Telemetry: Pipeline panel ACOUSTICS block (floor, SNR, env, VAD floor +
  reason, primary/echo %, music, bg-speech, buffer est, event trail);
  constraints row shows APPLIED settings; incident chain export
  (decisions only, never raw audio � privacy by construction).
- Degradation order: classifier fails ? VAD+turn continue; engine fails ?
  session runs as before (all calls null-guarded).
- Perf: one extra analyser, 90ms interval, skipped when hidden; expensive
  reasoning stays out of the audio loop (heuristic core, no models).
