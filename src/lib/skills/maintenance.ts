// Autonomous Idle Maintenance & Self-Improvement Engine (§40)
// Runs during idle time within strict compute and resource budgets.
// Inspects recurring weaknesses, runs regression tests on registered skills,
// cleans obsolete experiments, and generates the "What did you improve?" factual audit report.

import type { SelfImprovementReport } from './types';
import { SkillRegistry } from './registry';
import { SkillForge } from './forge';
import { CapabilityGapEngine } from './gapEngine';
import { SkillEvaluator } from './evaluator';

export class IdleMaintenanceEngine {
  private static isRunning = false;
  private static lastReport: SelfImprovementReport | null = null;

  /**
   * Execute an autonomous maintenance cycle.
   */
  static async runMaintenanceCycle(): Promise<SelfImprovementReport> {
    if (this.isRunning) {
      return this.lastReport || this.createEmptyReport();
    }

    this.isRunning = true;
    const newSkillsCreated: string[] = [];
    const improvedSkills: string[] = [];
    const fixedTools: string[] = [];
    const rolledBackVersions: string[] = [];
    const performanceGains: { skillId: string; metric: string; improvementPct: number }[] = [];
    let failedExperimentsCount = 0;

    try {
      // 1. Process Identified Capability Gaps
      const gaps = CapabilityGapEngine.getIdentifiedGaps().slice(0, 3); // Bound compute budget
      for (const gap of gaps) {
        const forgeRes = await SkillForge.forgeFromGap(gap);
        if (forgeRes.success && forgeRes.skillId) {
          newSkillsCreated.push(forgeRes.skillId);
        } else {
          failedExperimentsCount++;
        }
      }

      // 2. Health Check & Regression Benchmark on Existing Skills
      const allSkills = SkillRegistry.getAllSkills();
      for (const skill of allSkills) {
        const currentVer = skill.versions[skill.currentVersion];
        if (!currentVer) continue;

        const evalReport = await SkillEvaluator.evaluateVersion(
          skill.skillId,
          currentVer,
          skill.permissions,
          currentVer.benchmark
        );

        if (evalReport.regressionDetected) {
          // Automatic rollback on detected regression
          const rolled = SkillRegistry.rollback(skill.skillId, 'Autonomous maintenance detected regression.');
          if (rolled) rolledBackVersions.push(skill.skillId);
        } else if (evalReport.recommendation === 'DEPLOY_STABLE' && currentVer.status === 'CANARY') {
          // Promote verified canary to stable
          currentVer.status = 'STABLE';
          improvedSkills.push(skill.skillId);
        }

        // Check for performance optimizations
        if (evalReport.stages.benchmark.latencyMs < currentVer.benchmark.latencyMs) {
          const diff = currentVer.benchmark.latencyMs - evalReport.stages.benchmark.latencyMs;
          const pct = Math.round((diff / (currentVer.benchmark.latencyMs || 1)) * 100);
          if (pct > 5) {
            performanceGains.push({
              skillId: skill.skillId,
              metric: 'latency',
              improvementPct: pct,
            });
          }
        }
      }

      const remainingGaps = CapabilityGapEngine.getIdentifiedGaps().map((g) => g.proposedPurpose);

      const report: SelfImprovementReport = {
        generatedAt: Date.now(),
        newSkillsCreated,
        improvedSkills,
        fixedTools,
        rolledBackVersions,
        performanceGains,
        failedExperimentsCount,
        remainingGaps,
      };

      this.lastReport = report;
      return report;
    } finally {
      this.isRunning = false;
    }
  }

  static getLastReport(): SelfImprovementReport {
    return this.lastReport || this.createEmptyReport();
  }

  private static createEmptyReport(): SelfImprovementReport {
    return {
      generatedAt: Date.now(),
      newSkillsCreated: [],
      improvedSkills: [],
      fixedTools: [],
      rolledBackVersions: [],
      performanceGains: [],
      failedExperimentsCount: 0,
      remainingGaps: [],
    };
  }

  /**
   * Returns human-readable developer audit summary of "What did you improve?"
   */
  static formatImprovementSummary(report: SelfImprovementReport): string {
    const lines = [
      `### Autonomous Self-Improvement & Maintenance Report`,
      `*Timestamp: ${new Date(report.generatedAt).toLocaleTimeString()}*`,
      '',
      `**NEW SKILLS FORGED:** ${report.newSkillsCreated.length > 0 ? report.newSkillsCreated.join(', ') : 'None in this cycle'}`,
      `**IMPROVED / PROMOTED SKILLS:** ${report.improvedSkills.length > 0 ? report.improvedSkills.join(', ') : 'All currently optimal'}`,
      `**ROLLED BACK REGRESSIONS:** ${report.rolledBackVersions.length > 0 ? report.rolledBackVersions.join(', ') : '0 regressions detected'}`,
      `**PERFORMANCE GAINS:** ${
        report.performanceGains.length > 0
          ? report.performanceGains.map((p) => `${p.skillId} (${p.metric} +${p.improvementPct}%)`).join(', ')
          : 'Stable'
      }`,
      `**FAILED EXPERIMENTS (BOUNDED):** ${report.failedExperimentsCount}`,
      `**REMAINING GAPS IN BACKLOG:** ${report.remainingGaps.length}`,
    ];
    return lines.join('\n');
  }
}
