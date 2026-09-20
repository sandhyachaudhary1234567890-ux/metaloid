// Capability performance engine.
// Tracks per-device / per-session baselines and p50/p95/p99.
// Rollback is baseline-relative, sample-aware, and severity-weighted.
//
// Metric definitions:
//   TTFT — time from committed user turn / request start to first model token
//   TTFA — time from user speech end (STT final when present) to first audible audio
//   barge-in — time from interruptDetected to playback stopped
//   endpointing — time from speechEnd to turn committed
//   audio startup — time from TTS start to first audible frame

export type PerformanceCapability = 'VOICE' | 'CHAT' | 'UI' | 'RESEARCH' | 'AGENT' | 'PRODUCT_EVOLUTION';

export type VoiceMetric = 'TTFA' | 'barge_in' | 'endpointing' | 'audio_startup';
export type ChatMetric = 'TTFT' | 'completion';
export type UiMetric = 'interaction' | 'long_task' | 'frame_drop';
export type ResearchMetric = 'first_source' | 'completion' | 'source_quality' | 'citation_completeness';
export type AgentMetric = 'task_success' | 'intervention' | 'retry' | 'verification_failure';

export interface MetricSample {
  sessionId: string;
  deviceId: string;
  capability: PerformanceCapability;
  metric: string;
  value: number;
  ok: boolean;
  timeout?: boolean;
  retried?: boolean;
  at?: number;
}

export interface PercentileSnapshot {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  timeoutRate: number;
  retryRate: number;
}

export interface CanaryVerdict {
  status: 'HEALTHY' | 'WATCH' | 'ROLLED_BACK' | 'INSUFFICIENT_SAMPLE';
  reason: string;
  baseline?: PercentileSnapshot;
  observed?: PercentileSnapshot;
}

const MIN_SAMPLES = 16;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function snapshot(samples: MetricSample[]): PercentileSnapshot {
  const values = samples.map((s) => s.value).sort((a, b) => a - b);
  const n = samples.length || 1;
  return {
    n: samples.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    errorRate: samples.filter((s) => !s.ok).length / n,
    timeoutRate: samples.filter((s) => s.timeout).length / n,
    retryRate: samples.filter((s) => s.retried).length / n,
  };
}

function keyOf(s: Pick<MetricSample, 'deviceId' | 'sessionId' | 'capability' | 'metric'>): string {
  return `${s.deviceId}::${s.sessionId}::${s.capability}::${s.metric}`;
}

export class PerformanceEngine {
  private static samples: MetricSample[] = [];
  private static baselines = new Map<string, PercentileSnapshot>();

  static recordSample(sample: MetricSample): void {
    this.samples.push({ ...sample, at: sample.at ?? Date.now() });
    if (this.samples.length > 4000) this.samples.splice(0, this.samples.length - 4000);
  }

  static captureBaseline(filter: {
    deviceId: string;
    sessionId: string;
    capability: PerformanceCapability;
    metric: string;
  }): PercentileSnapshot | null {
    const matched = this.samples.filter(
      (s) =>
        s.deviceId === filter.deviceId &&
        s.sessionId === filter.sessionId &&
        s.capability === filter.capability &&
        s.metric === filter.metric
    );
    if (matched.length < MIN_SAMPLES) return null;
    const snap = snapshot(matched);
    this.baselines.set(keyOf(filter), snap);
    return snap;
  }

  static getSnapshot(filter: {
    deviceId?: string;
    sessionId?: string;
    capability: PerformanceCapability;
    metric: string;
  }): PercentileSnapshot {
    const matched = this.samples.filter(
      (s) =>
        s.capability === filter.capability &&
        s.metric === filter.metric &&
        (!filter.deviceId || s.deviceId === filter.deviceId) &&
        (!filter.sessionId || s.sessionId === filter.sessionId)
    );
    return snapshot(matched);
  }

  /**
   * Severity-weighted regression vs captured baseline.
   * A single raw latency number never triggers rollback.
   */
  static evaluateRegression(params: {
    deviceId: string;
    sessionId: string;
    capability: PerformanceCapability;
    metric: string;
    canarySamples: MetricSample[];
  }): CanaryVerdict {
    const baseline = this.baselines.get(
      keyOf({
        deviceId: params.deviceId,
        sessionId: params.sessionId,
        capability: params.capability,
        metric: params.metric,
      })
    );

    if (!baseline || baseline.n < MIN_SAMPLES) {
      return {
        status: 'INSUFFICIENT_SAMPLE',
        reason: 'No adequate per-device/session baseline. Refusing to treat a hardcoded latency as product truth.',
      };
    }

    if (params.canarySamples.length < MIN_SAMPLES) {
      return {
        status: 'INSUFFICIENT_SAMPLE',
        reason: `Canary n=${params.canarySamples.length} is below the sample floor (${MIN_SAMPLES}). Watching, not rolling back.`,
        baseline,
      };
    }

    const observed = snapshot(params.canarySamples);
    const latencyWeight = params.capability === 'VOICE' ? 1.4 : params.capability === 'UI' ? 1.2 : 1.0;
    const p95Delta = baseline.p95 === 0 ? 0 : (observed.p95 - baseline.p95) / baseline.p95;
    const errDelta = observed.errorRate - baseline.errorRate;

    const severeLatency = p95Delta > 0.35 * latencyWeight;
    const severeErrors = errDelta > 0.04 && observed.errorRate > baseline.errorRate * 1.8 + 0.01;

    if (severeLatency && severeErrors) {
      return {
        status: 'ROLLED_BACK',
        reason: `Regression vs baseline for ${params.capability}/${params.metric}: p95 ${baseline.p95.toFixed(0)}→${observed.p95.toFixed(0)} (${(p95Delta * 100).toFixed(0)}%), error ${(baseline.errorRate * 100).toFixed(1)}%→${(observed.errorRate * 100).toFixed(1)}%. Sample-adequate, severity-weighted rollback.`,
        baseline,
        observed,
      };
    }

    if (severeLatency || severeErrors) {
      return {
        status: 'WATCH',
        reason: `Single-dimension movement vs baseline for ${params.capability}/${params.metric} (p95 Δ ${(p95Delta * 100).toFixed(0)}%, err Δ ${(errDelta * 100).toFixed(1)}pp). Holding canary; not rolling back on one number.`,
        baseline,
        observed,
      };
    }

    return {
      status: 'HEALTHY',
      reason: `${params.capability}/${params.metric} within baseline envelope (p50 ${observed.p50.toFixed(0)}, p95 ${observed.p95.toFixed(0)}, p99 ${observed.p99.toFixed(0)}).`,
      baseline,
      observed,
    };
  }

  static resetForTests(): void {
    this.samples = [];
    this.baselines.clear();
  }
}
