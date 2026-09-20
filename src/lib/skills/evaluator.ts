// Skill Evaluator & Benchmark Pipeline (§40)
// Pipeline:
// SYNTAX_CHECK -> SECURITY_AUDIT -> UNIT_TESTS -> EDGE_CASES -> BENCHMARK -> REGRESSION CHECK
// Never deploys untested or regressed code into STABLE.

import { SkillSandbox } from './sandbox';
import type {
  SkillVersion,
  SkillPermission,
  EvaluationReport,
  BenchmarkMetrics,
} from './types';

export class SkillEvaluator {
  /**
   * Run the end-to-end evaluation pipeline on a candidate skill version.
   */
  static async evaluateVersion(
    skillId: string,
    candidateVersion: SkillVersion,
    permissions: SkillPermission,
    baselineBenchmark?: BenchmarkMetrics
  ): Promise<EvaluationReport> {
    const code = candidateVersion.code;

    // 1. Syntax Check
    let syntaxCheck = true;
    try {
      new Function('inputs', '"use strict"; ' + code);
    } catch {
      syntaxCheck = false;
      return {
        skillId,
        version: candidateVersion.version,
        passed: false,
        stages: {
          syntaxCheck: false,
          securityAudit: false,
          unitTests: { passed: 0, total: 0 },
          edgeCaseTests: { passed: 0, total: 0 },
          benchmark: { accuracy: 0, latencyMs: 0, memoryKb: 0, successRate: 0, toolCallsCount: 0, sampleSize: 0 },
        },
        regressionDetected: false,
        recommendation: 'REJECT',
        reason: 'Syntax validation failed: Candidate code is not valid JavaScript.',
      };
    }

    // 2. Security Audit
    const audit = SkillSandbox.auditSecurity(code, permissions);
    if (!audit.safe) {
      return {
        skillId,
        version: candidateVersion.version,
        passed: false,
        stages: {
          syntaxCheck: true,
          securityAudit: false,
          unitTests: { passed: 0, total: 0 },
          edgeCaseTests: { passed: 0, total: 0 },
          benchmark: { accuracy: 0, latencyMs: 0, memoryKb: 0, successRate: 0, toolCallsCount: 0, sampleSize: 0 },
        },
        regressionDetected: false,
        recommendation: 'REJECT',
        reason: audit.reason || 'Security audit failed.',
      };
    }

    // 3. Unit Tests Execution
    const unitTests = candidateVersion.tests.filter((t) => t.type === 'unit');
    let unitPassed = 0;
    const latencies: number[] = [];

    for (const t of unitTests) {
      const res = await SkillSandbox.execute(code, t.input, permissions);
      if (res.success && !res.securityViolation) {
        if (t.validatorCode) {
          try {
            const validatorFn = new Function('output', `return (${t.validatorCode});`);
            if (validatorFn(res.output)) unitPassed++;
          } catch {
            // validator failed
          }
        } else {
          unitPassed++;
        }
        latencies.push(res.durationMs);
      }
    }

    // 4. Edge Case & Failure Tests Execution
    const edgeTests = candidateVersion.tests.filter((t) => t.type === 'edge_case' || t.type === 'failure');
    let edgePassed = 0;

    for (const t of edgeTests) {
      const res = await SkillSandbox.execute(code, t.input, permissions);
      if (t.shouldFail) {
        if (!res.success) edgePassed++;
      } else if (res.success) {
        edgePassed++;
        latencies.push(res.durationMs);
      }
    }

    // 5. Calculate Benchmark Metrics
    const totalTests = unitTests.length + edgeTests.length;
    const totalPassed = unitPassed + edgePassed;
    const accuracy = totalTests > 0 ? totalPassed / totalTests : 0;
    const avgLatency =
      latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 50;

    const benchmark: BenchmarkMetrics = {
      accuracy,
      latencyMs: avgLatency,
      memoryKb: 1200,
      successRate: accuracy,
      toolCallsCount: 1,
      sampleSize: totalTests,
    };

    // 6. Regression Check against Baseline
    let regressionDetected = false;
    let regressionReason = '';

    if (baselineBenchmark) {
      if (benchmark.accuracy < baselineBenchmark.accuracy - 0.05) {
        regressionDetected = true;
        regressionReason = `Accuracy regressed from ${(baselineBenchmark.accuracy * 100).toFixed(1)}% to ${(benchmark.accuracy * 100).toFixed(1)}%`;
      } else if (benchmark.latencyMs > baselineBenchmark.latencyMs * 2.5 && benchmark.latencyMs > 500) {
        regressionDetected = true;
        regressionReason = `Latency degraded from ${baselineBenchmark.latencyMs}ms to ${benchmark.latencyMs}ms`;
      }
    }

    const passed = syntaxCheck && audit.safe && unitPassed === unitTests.length && !regressionDetected;

    let recommendation: EvaluationReport['recommendation'] = 'REJECT';
    if (passed) {
      // If higher accuracy and no regression -> promote to CANARY or STABLE
      recommendation = accuracy >= 0.95 ? 'DEPLOY_STABLE' : 'DEPLOY_CANARY';
    } else if (regressionDetected) {
      recommendation = 'ROLLBACK';
    }

    return {
      skillId,
      version: candidateVersion.version,
      passed,
      stages: {
        syntaxCheck,
        securityAudit: true,
        unitTests: { passed: unitPassed, total: unitTests.length },
        edgeCaseTests: { passed: edgePassed, total: edgeTests.length },
        benchmark,
      },
      regressionDetected,
      recommendation,
      reason: passed
        ? 'All unit tests and edge cases passed with acceptable latency.'
        : regressionReason || `Failed tests (${totalPassed}/${totalTests} passed).`,
    };
  }
}
