# VOICE TORTURE RESULTS — 20/20 (2026-09-20)

Rerun: `cd C:\metaloid\voicetest && node torture.cjs` (needs app :5173 + gateway :8787).
Rule: infra-green means nothing; only this matrix proves the loop.

## Environment

- Real Chrome (headless=new) + fake mic tone, puppeteer-driven, real app build
- Real gateway SSE (free models) for T12; scripted token-trickle elsewhere
- Headless limits (labeled, never hidden): no SR finals (Google service),
  dummy TTS voices (utterances slow, ~1.5–4s each), instant-audio variance

## Test outcomes (latest green run)

| # | Test | Result |
|---|------|--------|
| 01 | normal question | TTFA-proxy 454ms, full drain |
| 02 | very short ("Yes.") | holds, then speaks; drains |
| 03 | long (12 sentences) | TTFA 557ms, drains 49.5s |
| 04 | Hindi (Devanagari) | splits + speaks (danda fix verified) |
| 05 | Hinglish | TTFA 165–202ms |
| 06 | pause mid-sentence | holds `maybe`, no premature commit |
| 07 | stop button mid-speech | LISTENING ≤7ms, old-gen dropped |
| 08 | interrupt @300ms pre-audio | safe no-op, loop survives |
| 09 | interrupt halfway | LISTENING ≤9ms, old-gen dropped |
| 10/16 | immediate follow-up + rapid turns | gens sequential, no cross-talk |
| 11 | background-noise fillers | vetoed (`incomplete`) |
| 12 | gateway TTFT | ~2s first token, retry-on-transient |
| 13 | TTS failure path | drains via watchdog, never hangs |
| 14 | LLM failure | retry + demo fallback (transport) |
| 15 | STT reconnect | +2–6 restarts (storm guard; was +8311) |
| 17 | very long (12 segs) | drains fully |
| 18 | tool during speech | theatre suppressed online (code path) |
| 19 | topic change mid-answer | fresh gen speaks, old dies |
| 20 | close mid-life | IDLE, queue empty, tracks released |

## Metrics (latest green run)

- TTFT (gateway): ~2s · TTFA-proxy: min 165 / median ~2600 / max 4600ms
  (headless includes voice-list waits; warm-voice machines run near floor)
- Barge-in engine-clear: ~0.1–0.6ms; to-LISTENING: 1–9ms
- Turn accuracy: engine matrix 8/8 (Node, incl. Hinglish)
- False interrupts: 0 · Missed turns: n/a headless (needs live SR)
- Audio gaps: n/a headless (dummy utterances) · STT restarts: +2–6/20s
- TTS failures: 0 · Reconnect: clean

## Bugs this rig has caught (all fixed, all verified)

1. Recognition restart storm: 8,311 restarts/20s → ~25 (single-flight + epochs)
2. Drain race: `turnEnd`/LISTENING fired while audio still played
   (drain awaited a busy pump) → true-drain wait
3. Cumulative-feed duplicate emission → stream cursor
4. Devanagari danda missing from sentence punctuation → Hindi never split
5. Dead NVIDIA fallback (unentitled key) → gated off + try-next free slugs
6. Abort-every-POST-stream (`req.on('close')`) → `res.on('close')`
7. Gateway wedged-but-listening twice → preflight fail-fast + socket-error
   armor (res error listener, send guard, rejection logging)
