// Latency ledger (§1, §24). performance.now marks → TTFT/TTFA/barge-in.
// Readout lives in VoiceMode; counters stay local (no fake dashboards).

import type { LatencyMarks, LatencyReport } from './types';

const diff = (a?: number, b?: number) =>
  a !== undefined && b !== undefined && a >= b ? Math.round(a - b) : null;

export function summarizeLatency(m: LatencyMarks): LatencyReport {
  return {
    ttftMs: diff(m.llmFirst, m.sttFinal ?? m.speechEnd),
    ttfaMs: diff(m.audioStart, m.sttFinal ?? m.speechEnd),
    bargeInMs: diff(m.audioStopped, m.interruptDetected),
    endOfTurnMs: diff(m.sttFinal, m.speechEnd),
    totalMs: diff(m.turnEnd, m.micStart),
  };
}

export function formatLatency(r: LatencyReport): string {
  const f = (v: number | null) => (v === null ? '—' : `${v}ms`);
  return `TTFT ${f(r.ttftMs)} · TTFA ${f(r.ttfaMs)} · barge-in ${f(r.bargeInMs)} · turn-end ${f(r.endOfTurnMs)}`;
}
