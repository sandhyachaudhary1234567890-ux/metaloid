// MetaIoid Continuous Product Evolution, Feature Discovery & Next-Gen Experience Engine
// Governs the continuous evolution loop:
// OBSERVE -> RESEARCH -> IDENTIFY OPPORTUNITY -> GENERATE IDEAS -> PRIORITIZE ->
// PROTOTYPE -> TEST -> BENCHMARK -> CANARY -> RELEASE -> MEASURE -> LEARN -> REPEAT
// Strictly separated from System A (Agent Skill Forge) to evolve UI/UX, capabilities, and platform architecture safely.

import { PerformanceEngine, type MetricSample, type PerformanceCapability } from './performanceEngine';

const GUARDED_EVOLUTION = /authentication|authorization|security policy|billing|privacy control|audit control|device ownership/i;

function toCapability(cap?: string): PerformanceCapability {
  switch (cap) {
    case 'voice':
      return 'VOICE';
    case 'chat':
      return 'CHAT';
    case 'research':
      return 'RESEARCH';
    case 'agent':
      return 'AGENT';
    default:
      return 'UI';
  }
}

export type FeatureState =
  | 'IDEA'
  | 'RESEARCH'
  | 'PROTOTYPE'
  | 'EXPERIMENTAL'
  | 'CANARY'
  | 'STABLE'
  | 'DEPRECATED';

export interface ProductTelemetrySignal {
  category: 'voice' | 'research' | 'ui_ux' | 'latency' | 'document' | 'memory' | 'companion';
  metric: string;
  value: number;
  benchmarkTarget: number;
  failureRate: number; // 0 to 1
  frictionReportsCount: number;
  timestamp: number;
}

export interface FeatureCandidate {
  featureId: string;
  name: string;
  problem: string;
  userValue: string;
  targetUsers: string;
  state: FeatureState;
  dependencies: string[];
  implementationCost: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  expectedImpact: number; // 1 to 10
  feasibilityScore: number; // 1 to 10
  compositePriorityScore: number; // computed
  successMetric: string;
  canaryRolloutPercent: number; // 0 to 100
  createdAt: number;
  updatedAt: number;
}

export interface EvolutionChangelogItem {
  id: string;
  type: 'NEW' | 'IMPROVED' | 'FIXED' | 'EXPERIMENTAL' | 'REMOVED';
  title: string;
  description: string;
  version: string;
  date: string;
}

export class ProductEvolutionEngine {
  private static candidates: Map<string, FeatureCandidate> = new Map();
  private static telemetryHistory: ProductTelemetrySignal[] = [];
  private static changelog: EvolutionChangelogItem[] = [
    {
      id: 'log_1',
      type: 'NEW',
      title: 'Real Binary OpenXML .pptx Generator',
      description: 'Zero-dependency PKZip packaging with verifiable magic bytes for Microsoft PowerPoint & LibreOffice.',
      version: '2.4.0',
      date: 'This week',
    },
    {
      id: 'log_2',
      type: 'IMPROVED',
      title: 'Voice Interruption & Barge-in Latency',
      description: 'Dynamic endpointing with trailing continuer protection and stale audio generation rejection.',
      version: '2.4.0',
      date: 'This week',
    },
    {
      id: 'log_3',
      type: 'FIXED',
      title: 'Long-Duration Checkpoint Retention',
      description: 'Automated orphan task reaper and checkpoint pruner for 24h background autonomy.',
      version: '2.4.0',
      date: 'This week',
    },
    {
      id: 'log_4',
      type: 'EXPERIMENTAL',
      title: 'Unified Phone-to-Laptop Companion Bridge',
      description: 'Cross-device voice command dispatch with self-healing engineering loop.',
      version: '2.5.0-exp',
      date: 'This week',
    },
  ];

  /**
   * Observe product telemetry and collect signals without invading privacy.
   */
  static recordTelemetrySignal(signal: ProductTelemetrySignal): void {
    this.telemetryHistory.push(signal);
    if (this.telemetryHistory.length > 500) {
      this.telemetryHistory.shift();
    }
  }

  /**
   * Product Research Agent: Evaluates external ecosystem developments.
   */
  static analyzeEcosystemPattern(input: {
    patternName: string;
    source: string;
    whatIsNew: string;
    whyItMatters: string;
    fitsMetaIoid: boolean;
  }): { recommendation: 'ADOPT' | 'EXPLORE' | 'IGNORE'; reason: string } {
    if (!input.fitsMetaIoid) {
      return {
        recommendation: 'IGNORE',
        reason: 'Does not align with MetaIoid quiet, technical, human-centered identity.',
      };
    }
    return {
      recommendation: 'EXPLORE',
      reason: `Valuable pattern: ${input.whyItMatters}. Evaluated for FeatureLab prototyping.`,
    };
  }

  /**
   * Generate prioritized candidate ideas based on telemetry friction & research.
   */
  static proposeFeature(
    candidate: Omit<FeatureCandidate, 'compositePriorityScore' | 'createdAt' | 'updatedAt' | 'canaryRolloutPercent'>
  ): FeatureCandidate {
    // Score using: User Value, Impact, Feasibility, Cost, Risk
    if (GUARDED_EVOLUTION.test(`${candidate.name} ${candidate.problem} ${candidate.userValue}`)) {
      throw new Error('MetaIoid must not silently rewrite authentication, authorization, billing, privacy, audit, or device ownership controls.');
    }

    const costPenalty = candidate.implementationCost === 'high' ? 3 : candidate.implementationCost === 'medium' ? 1.5 : 0;
    const riskPenalty = candidate.risk === 'high' ? 3 : candidate.risk === 'medium' ? 1.5 : 0;
    const compositeScore = Math.max(1, candidate.expectedImpact * 1.5 + candidate.feasibilityScore - costPenalty - riskPenalty);

    const fullCandidate: FeatureCandidate = {
      ...candidate,
      compositePriorityScore: Math.round(compositeScore * 10) / 10,
      canaryRolloutPercent: candidate.state === 'CANARY' ? 10 : candidate.state === 'STABLE' ? 100 : 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.candidates.set(fullCandidate.featureId, fullCandidate);
    return fullCandidate;
  }

  /**
   * Promote a candidate through the FeatureLab lifecycle:
   * IDEA -> RESEARCH -> PROTOTYPE -> EXPERIMENTAL -> CANARY -> STABLE
   */
  static promoteFeature(featureId: string, nextState: FeatureState): FeatureCandidate | null {
    const feat = this.candidates.get(featureId);
    if (!feat) return null;

    feat.state = nextState;
    feat.updatedAt = Date.now();

    if (nextState === 'CANARY') {
      feat.canaryRolloutPercent = 15;
    } else if (nextState === 'STABLE') {
      feat.canaryRolloutPercent = 100;
      this.changelog.unshift({
        id: `log_${Date.now()}`,
        type: 'NEW',
        title: feat.name,
        description: feat.userValue,
        version: '2.5.0',
        date: 'Today',
      });
    }

    return feat;
  }

  /**
   * Canary rollback uses per-device/session baselines, p50/p95/p99, and sample adequacy.
   * Hardcoded Voice 60ms / Chat 120ms / UI 35ms values are not product truth.
   */
  static evaluateCanaryHealth(
    featureId: string,
    metrics: {
      errorRate?: number;
      latencyIncreaseMs?: number;
      capability?: 'voice' | 'chat' | 'ui' | 'research' | 'agent';
      deviceId?: string;
      sessionId?: string;
      metric?: string;
      samples?: number[];
      sampleOk?: boolean[];
    }
  ): { status: 'HEALTHY' | 'ROLLED_BACK' | 'WATCH' | 'INSUFFICIENT_SAMPLE'; reason: string } {
    const feat = this.candidates.get(featureId);
    if (!feat) return { status: 'HEALTHY', reason: 'Feature not found' };

    const capability = toCapability(metrics.capability);
    const deviceId = metrics.deviceId || 'default-device';
    const sessionId = metrics.sessionId || 'default-session';
    const metric = metrics.metric || (capability === 'VOICE' ? 'TTFA' : capability === 'CHAT' ? 'TTFT' : 'interaction');

    if (!metrics.samples || metrics.samples.length === 0) {
      return {
        status: 'INSUFFICIENT_SAMPLE',
        reason: `Refusing rollback on a raw number (latencyIncreaseMs=${metrics.latencyIncreaseMs ?? 'n/a'}). ${capability} requires a session baseline plus p50/p95/p99.`,
      };
    }

    const canarySamples: MetricSample[] = metrics.samples.map((value, i) => ({
      sessionId,
      deviceId,
      capability,
      metric,
      value,
      ok: metrics.sampleOk?.[i] ?? (metrics.errorRate !== undefined ? Math.random() > metrics.errorRate : true),
    }));

    const verdict = PerformanceEngine.evaluateRegression({
      deviceId,
      sessionId,
      capability,
      metric,
      canarySamples,
    });

    if (verdict.status === 'ROLLED_BACK') {
      feat.state = 'EXPERIMENTAL';
      feat.canaryRolloutPercent = 0;
      feat.updatedAt = Date.now();
    }

    return { status: verdict.status, reason: verdict.reason };
  }

  /**
   * Retrieve human-readable changelog for Evolution Center.
   */
  static getChangelog(): EvolutionChangelogItem[] {
    return this.changelog;
  }

  /**
   * Retrieve all feature candidates in the FeatureLab.
   */
  static getAllCandidates(): FeatureCandidate[] {
    return Array.from(this.candidates.values()).sort(
      (a, b) => b.compositePriorityScore - a.compositePriorityScore
    );
  }
}
