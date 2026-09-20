export type AgentQualitySnapshot = {
  taskSuccessRate: number;
  verifiedSuccessRate: number;
  interventionRate: number;
  unnecessaryInterruptionRate: number;
  recoverySuccessRate: number;
  duplicateActionRate: number;
  initiativePrecision: number;
  initiativeRecall: number;
  toolFailureRecovery: number;
  averageRetries: number;
  completionLatencyMs: number;
  verificationFailureRate: number;
};

type Counters = {
  tasks: number;
  taskSuccess: number;
  verifiedSuccess: number;
  interventions: number;
  unnecessaryInterruptions: number;
  recoveries: number;
  recoverySuccess: number;
  duplicatesPrevented: number;
  actions: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  toolFailures: number;
  toolRecovered: number;
  retries: number;
  completionLatencySum: number;
  verificationFailures: number;
  verifications: number;
};

export class AgentQualityMetrics {
  private static c: Counters = AgentQualityMetrics.empty();

  private static empty(): Counters {
    return {
      tasks: 0,
      taskSuccess: 0,
      verifiedSuccess: 0,
      interventions: 0,
      unnecessaryInterruptions: 0,
      recoveries: 0,
      recoverySuccess: 0,
      duplicatesPrevented: 0,
      actions: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      toolFailures: 0,
      toolRecovered: 0,
      retries: 0,
      completionLatencySum: 0,
      verificationFailures: 0,
      verifications: 0,
    };
  }

  static record(partial: Partial<Counters>): void {
    for (const [k, v] of Object.entries(partial) as [keyof Counters, number][]) {
      this.c[k] += v;
    }
  }

  static snapshot(): AgentQualitySnapshot {
    const c = this.c;
    const div = (n: number, d: number) => (d === 0 ? 0 : n / d);
    return {
      taskSuccessRate: div(c.taskSuccess, c.tasks),
      verifiedSuccessRate: div(c.verifiedSuccess, c.tasks),
      interventionRate: div(c.interventions, c.tasks),
      unnecessaryInterruptionRate: div(c.unnecessaryInterruptions, c.actions || c.tasks),
      recoverySuccessRate: div(c.recoverySuccess, c.recoveries),
      duplicateActionRate: div(c.duplicatesPrevented, c.actions),
      initiativePrecision: div(c.truePositives, c.truePositives + c.falsePositives),
      initiativeRecall: div(c.truePositives, c.truePositives + c.falseNegatives),
      toolFailureRecovery: div(c.toolRecovered, c.toolFailures),
      averageRetries: div(c.retries, c.tasks),
      completionLatencyMs: div(c.completionLatencySum, c.tasks),
      verificationFailureRate: div(c.verificationFailures, c.verifications),
    };
  }

  static resetForTests(): void {
    this.c = this.empty();
  }
}
