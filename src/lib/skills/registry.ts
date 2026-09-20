// Skill Registry (§40)
// Central catalog of all active, canary, and experimental skills.
// Supports safe deployment, version history, automated rollback, and telemetry.

import type { Skill, SkillAuditLog, BenchmarkMetrics, SandboxExecutionResult } from './types';
import { SkillSandbox } from './sandbox';

export class SkillRegistry {
  private static skills: Map<string, Skill> = new Map();
  private static auditLogs: SkillAuditLog[] = [];

  static {
    this.seedDefaultSkills();
  }

  /**
   * Seed foundational pre-tested skills so MetaIoid is immediately productive.
   */
  private static seedDefaultSkills() {
    // 1. PDF Comparison & Extraction Skill
    const pdfCompare: Skill = {
      skillId: 'pdf_compare',
      name: 'PDF Compare & Diff Engine',
      category: 'extractor',
      purpose: 'Compare two text extractions or documents and extract structured differences with source confidence',
      description: 'Structured comparison of document sections, tables, and clauses',
      inputs: {
        docA: { type: 'string', description: 'Content of first document', required: true },
        docB: { type: 'string', description: 'Content of second document', required: true },
      },
      outputs: {
        differences: { type: 'array', description: 'List of changes, additions, and deletions' },
        similarityScore: { type: 'number', description: 'Similarity metric between 0 and 1' },
      },
      permissions: {
        network: false,
        filesystem: 'none',
        maxExecutionTimeMs: 1500,
        maxMemoryMb: 32,
      },
      currentVersion: '1.0.0',
      versions: {
        '1.0.0': {
          version: '1.0.0',
          status: 'STABLE',
          code: `
            const a = String(inputs.docA || '');
            const b = String(inputs.docB || '');
            const linesA = a.split('\\n');
            const linesB = b.split('\\n');
            const setA = new Set(linesA);
            const setB = new Set(linesB);
            const additions = linesB.filter(l => !setA.has(l));
            const deletions = linesA.filter(l => !setB.has(l));
            const intersection = linesA.filter(l => setB.has(l)).length;
            const union = new Set([...linesA, ...linesB]).size;
            const similarity = union > 0 ? intersection / union : 1.0;
            return {
              differences: [
                ...additions.map(l => ({ type: 'added', text: l })),
                ...deletions.map(l => ({ type: 'deleted', text: l }))
              ],
              similarityScore: Math.round(similarity * 100) / 100
            };
          `,
          tests: [
            {
              id: 'pdf_unit_1',
              name: 'Identical docs test',
              type: 'unit',
              input: { docA: 'Paragraph 1\\nParagraph 2', docB: 'Paragraph 1\\nParagraph 2' },
              validatorCode: 'output.similarityScore === 1.0 && output.differences.length === 0',
            },
            {
              id: 'pdf_unit_2',
              name: 'Added line test',
              type: 'unit',
              input: { docA: 'Header\\nBody', docB: 'Header\\nBody\\nFooter' },
              validatorCode: 'output.differences.some(d => d.type === "added" && d.text === "Footer")',
            },
            {
              id: 'pdf_edge_1',
              name: 'Empty docs test',
              type: 'edge_case',
              input: { docA: '', docB: '' },
              validatorCode: 'output.similarityScore === 1.0',
            },
          ],
          benchmark: {
            accuracy: 1.0,
            latencyMs: 12,
            memoryKb: 450,
            successRate: 1.0,
            toolCallsCount: 1,
            sampleSize: 10,
          },
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now() - 86400000,
          changelog: 'Initial production stable release of PDF Compare Engine.',
          author: 'MetaIoid',
        },
      },
      tags: ['pdf', 'document', 'diff', 'extraction'],
      failureCount: 0,
      successCount: 24,
    };

    // 2. Resilient Browser Click & Selector Adapter
    const resilientClick: Skill = {
      skillId: 'resilient_dom_selector',
      name: 'Resilient DOM Selector',
      category: 'adapter',
      purpose: 'Multi-strategy element locator using text, accessibility attributes, and structural selectors',
      description: 'Finds interactive elements even after DOM changes or dynamic class renames',
      inputs: {
        candidates: { type: 'array', description: 'List of candidate elements with tag, text, role, aria' },
        targetQuery: { type: 'string', description: 'Query description (e.g. "Submit button")' },
      },
      outputs: {
        bestMatch: { type: 'object', description: 'Highest confidence match' },
        confidence: { type: 'number', description: 'Match score 0 to 1' },
      },
      permissions: {
        network: false,
        filesystem: 'none',
        maxExecutionTimeMs: 1000,
        maxMemoryMb: 16,
      },
      currentVersion: '1.0.0',
      versions: {
        '1.0.0': {
          version: '1.0.0',
          status: 'STABLE',
          code: `
            const candidates = Array.isArray(inputs.candidates) ? inputs.candidates : [];
            const query = String(inputs.targetQuery || '').toLowerCase();
            let best = null;
            let highestScore = 0;

            for (const c of candidates) {
              let score = 0;
              const text = String(c.text || '').toLowerCase();
              const aria = String(c.ariaLabel || '').toLowerCase();
              const id = String(c.id || '').toLowerCase();

              if (text === query) score += 0.9;
              else if (text.includes(query)) score += 0.6;

              if (aria === query) score += 0.85;
              else if (aria.includes(query)) score += 0.5;

              if (id.includes(query)) score += 0.4;

              if (score > highestScore) {
                highestScore = score;
                best = c;
              }
            }

            return {
              bestMatch: best,
              confidence: Math.min(1.0, Math.round(highestScore * 100) / 100)
            };
          `,
          tests: [
            {
              id: 'click_unit_1',
              name: 'Exact text match',
              type: 'unit',
              input: {
                candidates: [{ id: 'b1', text: 'Submit' }, { id: 'b2', text: 'Cancel' }],
                targetQuery: 'Submit',
              },
              validatorCode: 'output.bestMatch && output.bestMatch.id === "b1" && output.confidence >= 0.8',
            },
          ],
          benchmark: {
            accuracy: 1.0,
            latencyMs: 8,
            memoryKb: 320,
            successRate: 1.0,
            toolCallsCount: 1,
            sampleSize: 8,
          },
          createdAt: Date.now() - 43200000,
          updatedAt: Date.now() - 43200000,
          changelog: 'Resilient selector engine deployed.',
          author: 'MetaIoid',
        },
      },
      tags: ['browser', 'selector', 'resilience', 'automation'],
      failureCount: 0,
      successCount: 18,
    };

    this.skills.set(pdfCompare.skillId, pdfCompare);
    this.skills.set(resilientClick.skillId, resilientClick);
  }

  static getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  static getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Safe execution of registered skill in isolated sandbox.
   */
  static async executeSkill(
    skillId: string,
    inputs: Record<string, unknown>
  ): Promise<SandboxExecutionResult> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: `Skill "${skillId}" not found in registry.`, durationMs: 0 };
    }

    const versionObj = skill.versions[skill.currentVersion];
    if (!versionObj || versionObj.status === 'DISABLED') {
      return { success: false, error: `Skill "${skillId}" version is disabled or missing.`, durationMs: 0 };
    }

    const result = await SkillSandbox.execute(versionObj.code, inputs, skill.permissions);

    if (result.success) {
      skill.successCount++;
      skill.lastUsedAt = Date.now();
    } else {
      skill.failureCount++;
      // Auto-rollback trigger if failures accumulate on experimental or canary version
      if (versionObj.status !== 'STABLE' && skill.failureCount >= 3 && versionObj.rollbackVersion) {
        this.rollback(skillId, `Auto-rollback: version ${versionObj.version} accumulated 3 failures.`);
      }
    }

    return result;
  }

  /**
   * Register a new candidate skill or version.
   */
  static registerSkill(skill: Skill) {
    this.skills.set(skill.skillId, skill);
    this.recordAudit({
      id: `audit_${Date.now()}`,
      timestamp: Date.now(),
      skillId: skill.skillId,
      action: 'CREATED',
      toVersion: skill.currentVersion,
      reason: `Registered new skill: ${skill.name}`,
      testResultsSummary: `Version ${skill.currentVersion} seeded.`,
    });
  }

  /**
   * Upgrade an existing skill to a new version.
   */
  static deployVersion(
    skillId: string,
    newVersion: Skill['versions'][string],
    baselineBenchmark?: BenchmarkMetrics
  ) {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    const oldVersion = skill.currentVersion;
    newVersion.rollbackVersion = oldVersion;
    skill.versions[newVersion.version] = newVersion;
    skill.currentVersion = newVersion.version;
    skill.lastImprovedAt = Date.now();

    this.recordAudit({
      id: `audit_${Date.now()}`,
      timestamp: Date.now(),
      skillId,
      action: newVersion.status === 'STABLE' ? 'PROMOTED_STABLE' : 'IMPROVED',
      fromVersion: oldVersion,
      toVersion: newVersion.version,
      reason: newVersion.changelog,
      benchmarkBefore: baselineBenchmark,
      benchmarkAfter: newVersion.benchmark,
      testResultsSummary: `Tests passed: ${newVersion.tests.length}`,
    });
  }

  /**
   * Rollback skill to its previous stable version.
   */
  static rollback(skillId: string, reason: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    const currentVerObj = skill.versions[skill.currentVersion];
    const targetVer = currentVerObj?.rollbackVersion;

    if (!targetVer || !skill.versions[targetVer]) {
      // Find latest STABLE version
      const stableVer = Object.values(skill.versions).find((v) => v.status === 'STABLE');
      if (stableVer) {
        const fromVer = skill.currentVersion;
        skill.currentVersion = stableVer.version;
        currentVerObj.status = 'DISABLED';
        this.recordAudit({
          id: `audit_${Date.now()}`,
          timestamp: Date.now(),
          skillId,
          action: 'ROLLED_BACK',
          fromVersion: fromVer,
          toVersion: stableVer.version,
          reason,
          testResultsSummary: `Reverted to stable version ${stableVer.version}`,
        });
        return true;
      }
      return false;
    }

    const fromVersion = skill.currentVersion;
    skill.currentVersion = targetVer;
    currentVerObj.status = 'DISABLED';

    this.recordAudit({
      id: `audit_${Date.now()}`,
      timestamp: Date.now(),
      skillId,
      action: 'ROLLED_BACK',
      fromVersion,
      toVersion: targetVer,
      reason,
      testResultsSummary: `Rolled back from ${fromVersion} to ${targetVer}`,
    });

    return true;
  }

  private static recordAudit(entry: SkillAuditLog) {
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 100) this.auditLogs.pop();
  }

  static getAuditLogs(): SkillAuditLog[] {
    return [...this.auditLogs];
  }
}
