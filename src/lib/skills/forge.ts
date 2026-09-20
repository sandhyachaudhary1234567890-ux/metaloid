// Autonomous Skill Forge & Tool Builder (§40)
// Takes identified capability gaps or reusable workflow extractions,
// designs, synthesizes code & tests, runs sandboxed benchmark pipeline,
// and safely registers new skills or versions.

import type { Skill, SkillVersion, TestCase, CapabilityGap } from './types';
import { SkillRegistry } from './registry';
import { SkillEvaluator } from './evaluator';
import { CapabilityGapEngine } from './gapEngine';

export class SkillForge {
  /**
   * Autonomously forge a new skill from an identified gap or workflow extraction.
   */
  static async forgeFromGap(gap: CapabilityGap): Promise<{ success: boolean; skillId?: string; reason?: string }> {
    CapabilityGapEngine.markGapStatus(gap.id, 'FORGING');

    const skillId = gap.proposedSkillName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const existing = SkillRegistry.getSkill(skillId);

    // If equivalent stable skill exists, avoid duplicate tool explosion
    if (existing && existing.versions[existing.currentVersion]?.status === 'STABLE') {
      CapabilityGapEngine.markGapStatus(gap.id, 'RESOLVED');
      return {
        success: true,
        skillId: existing.skillId,
        reason: `Reused existing stable skill "${existing.name}".`,
      };
    }

    // 1. Synthesize Code, Inputs, Outputs, and Tests
    const blueprint = this.synthesizeBlueprint(gap);

    // 2. Evaluate in isolated worker sandbox
    const evalReport = await SkillEvaluator.evaluateVersion(
      blueprint.skill.skillId,
      blueprint.version,
      blueprint.skill.permissions
    );

    if (!evalReport.passed) {
      CapabilityGapEngine.markGapStatus(gap.id, 'DISMISSED');
      return {
        success: false,
        reason: `Forge evaluation failed: ${evalReport.reason}`,
      };
    }

    // 3. Set deployment tier based on recommendation
    blueprint.version.status = evalReport.recommendation === 'DEPLOY_STABLE' ? 'STABLE' : 'CANARY';
    blueprint.version.benchmark = evalReport.stages.benchmark;

    // 4. Register in SkillRegistry
    blueprint.skill.versions[blueprint.version.version] = blueprint.version;
    blueprint.skill.currentVersion = blueprint.version.version;
    SkillRegistry.registerSkill(blueprint.skill);

    CapabilityGapEngine.markGapStatus(gap.id, 'RESOLVED');

    return {
      success: true,
      skillId: blueprint.skill.skillId,
      reason: `Successfully forged and deployed version ${blueprint.version.version} as ${blueprint.version.status}.`,
    };
  }

  /**
   * Deterministic blueprint synthesizer for common gap archetypes.
   */
  private static synthesizeBlueprint(gap: CapabilityGap): { skill: Skill; version: SkillVersion } {
    const skillId = gap.proposedSkillName.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    let code = '';
    let tests: TestCase[] = [];
    let inputs: Skill['inputs'] = {};
    let outputs: Skill['outputs'] = {};

    if (gap.proposedSkillName.includes('deep_research') || gap.source === 'workflow_extraction') {
      inputs = {
        query: { type: 'string', description: 'Primary research topic', required: true },
        depth: { type: 'number', description: 'Search depth iterations' },
      };
      outputs = {
        subQueries: { type: 'array', description: 'Decomposed sub-topics' },
        synthesisPlan: { type: 'object', description: 'Parallel execution roadmap' },
      };
      code = `
        const q = String(inputs.query || '').trim();
        const depth = Math.min(Number(inputs.depth) || 2, 4);
        const words = q.split(/\\s+/);
        const subQueries = [
          q,
          words.length > 2 ? words.slice(0, 3).join(' ') + ' latest developments' : q + ' overview',
          q + ' official specifications analysis'
        ];
        return {
          subQueries,
          synthesisPlan: {
            strategy: 'parallel_cross_check',
            iterations: depth,
            prioritySources: ['official_docs', 'academic', 'primary_repo']
          }
        };
      `;
      tests = [
        {
          id: 'test_research_1',
          name: 'Decomposes query into structured sub-queries',
          type: 'unit',
          input: { query: 'NextJS Server Actions performance' },
          validatorCode: 'Array.isArray(output.subQueries) && output.subQueries.length >= 2',
        },
        {
          id: 'test_research_2',
          name: 'Bounds depth parameters',
          type: 'edge_case',
          input: { query: 'React compiler', depth: 99 },
          validatorCode: 'output.synthesisPlan.iterations <= 4',
        },
      ];
    } else if (gap.proposedSkillName.includes('table') || gap.proposedSkillName.includes('csv')) {
      inputs = {
        rawCsv: { type: 'string', description: 'Raw CSV/TSV table string', required: true },
      };
      outputs = {
        headers: { type: 'array', description: 'Parsed table headers' },
        rows: { type: 'array', description: 'Structured records' },
        rowCount: { type: 'number', description: 'Total records parsed' },
      };
      code = `
        const raw = String(inputs.rawCsv || '').trim();
        if (!raw) return { headers: [], rows: [], rowCount: 0 };
        const lines = raw.split(/\\r?\\n/).filter(l => l.trim().length > 0);
        if (lines.length === 0) return { headers: [], rows: [], rowCount: 0 };
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
          const record = {};
          headers.forEach((h, idx) => {
            record[h] = cells[idx] !== undefined ? cells[idx] : '';
          });
          rows.push(record);
        }
        return { headers, rows, rowCount: rows.length };
      `;
      tests = [
        {
          id: 'test_table_1',
          name: 'Parses standard comma delimited table',
          type: 'unit',
          input: { rawCsv: 'name,role,level\\nAlice,Engineer,Senior\\nBob,Designer,Lead' },
          validatorCode: 'output.rowCount === 2 && output.headers.includes("role")',
        },
        {
          id: 'test_table_2',
          name: 'Handles empty input cleanly',
          type: 'edge_case',
          input: { rawCsv: '' },
          validatorCode: 'output.rowCount === 0 && output.headers.length === 0',
        },
      ];
    } else {
      inputs = {
        text: { type: 'string', description: 'Input text content', required: true },
      };
      outputs = {
        normalized: { type: 'string', description: 'Normalized cleaned output' },
        metadata: { type: 'object', description: 'Extraction metadata' },
      };
      code = `
        const raw = String(inputs.text || '').trim();
        const cleaned = raw.replace(/[ \\t]+/g, ' ');
        return {
          normalized: cleaned,
          metadata: { length: cleaned.length, wordsCount: cleaned ? cleaned.split(/\\s+/).length : 0 }
        };
      `;
      tests = [
        {
          id: 'test_norm_1',
          name: 'Collapses whitespace and extracts word count',
          type: 'unit',
          input: { text: 'Hello    world   from   MetaIoid' },
          validatorCode: 'output.normalized === "Hello world from MetaIoid" && output.metadata.wordsCount === 4',
        },
      ];
    }

    const version: SkillVersion = {
      version: '1.0.0',
      status: 'EXPERIMENTAL',
      code,
      tests,
      benchmark: { accuracy: 0, latencyMs: 0, memoryKb: 0, successRate: 0, toolCallsCount: 1, sampleSize: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      changelog: `Autonomously synthesized to resolve capability gap: ${gap.proposedPurpose}`,
      author: 'MetaIoid',
    };

    const skill: Skill = {
      skillId,
      name: gap.proposedSkillName.replace(/_/g, ' ').toUpperCase(),
      category: gap.proposedCategory,
      purpose: gap.proposedPurpose,
      description: `Autonomous skill created by MetaIoid for ${gap.proposedPurpose}`,
      inputs,
      outputs,
      permissions: {
        network: false,
        filesystem: 'none',
        maxExecutionTimeMs: 1500,
        maxMemoryMb: 32,
      },
      currentVersion: '1.0.0',
      versions: {},
      tags: [gap.proposedCategory, 'autonomous', 'forged'],
      failureCount: 0,
      successCount: 0,
    };

    return { skill, version };
  }
}
