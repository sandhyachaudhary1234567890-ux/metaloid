// Pipeline telemetry: the 8-point diagnostic ledger.
// MIC · VAD · STT · TURN · LLM · TTS · PLAYBACK (+ session).
// Every layer reports idle/active/ok/dead with a detail string.
// When voice breaks, this says exactly which layer is dead.

export type StageId = 'MIC' | 'VAD' | 'STT' | 'TURN' | 'LLM' | 'TTS' | 'PLAYBACK';
export type StageStatus = 'idle' | 'active' | 'ok' | 'dead';

export interface StageInfo {
  status: StageStatus;
  detail: string;
  at: number;
}

const ORDER: StageId[] = ['MIC', 'VAD', 'STT', 'TURN', 'LLM', 'TTS', 'PLAYBACK'];

export class StageLedger {
  private stages = new Map<StageId, StageInfo>();

  constructor() {
    for (const id of ORDER) {
      this.stages.set(id, { status: 'idle', detail: '—', at: Date.now() });
    }
  }

  set(id: StageId, status: StageStatus, detail = '') {
    this.stages.set(id, { status, detail: detail.slice(0, 90), at: Date.now() });
  }

  snapshot(): Record<StageId, StageInfo> {
    const out = {} as Record<StageId, StageInfo>;
    for (const id of ORDER) out[id] = this.stages.get(id)!;
    return out;
  }

  reset() {
    for (const id of ORDER) {
      this.stages.set(id, { status: 'idle', detail: '—', at: Date.now() });
    }
  }
}
