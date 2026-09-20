// Capability Gap Engine (§40)
// 1. Structured Failure Triage:
//    Classifies errors into:
//    - CAPABILITY_MISSING (trigger Skill Forge)
//    - TOOL_INSUFFICIENT (improve existing skill)
//    - ROUTING_MISMATCH (tune router)
//    - PROMPT_UNCLEAR (clarify instructions)
//    - MODEL_CAPACITY_LIMIT (fallback to smarter model)
//    - TRANSIENT_NETWORK_ERROR (retry)
//
// 2. Successful Workflow Reusable Extraction:
//    Inspects high-value multi-step successes and extracts reusable skills/automation recipes.

import type { CapabilityGap, FailureClassification, SkillCategory } from './types';

export interface TaskOutcomeContext {
  task: string;
  success: boolean;
  toolUsed?: string;
  stepsCount: number;
  error?: string;
  userCorrection?: string;
  toolsInvoked?: string[];
  executionTimeMs: number;
  outputQualityScore?: number;
}

export class CapabilityGapEngine {
  private static detectedGaps: CapabilityGap[] = [];

  /**
   * Triage a failed task to determine exact root cause and whether a skill candidate is warranted.
   */
  static triageFailure(ctx: TaskOutcomeContext): CapabilityGap | null {
    const errorText = (ctx.error || '').toLowerCase();
    const taskText = (ctx.task || '').toLowerCase();
    const correction = (ctx.userCorrection || '').toLowerCase();

    let classification: FailureClassification = 'TOOL_INSUFFICIENT';
    let proposedSkillName = '';
    let proposedCategory: SkillCategory = 'workflow';
    let proposedPurpose = '';

    // 1. Check for missing capability
    if (
      errorText.includes('no tool found') ||
      errorText.includes('unsupported format') ||
      taskText.includes('pdf') ||
      taskText.includes('csv table') ||
      correction.includes("you don't have") ||
      correction.includes('missing capability')
    ) {
      classification = 'CAPABILITY_MISSING';
      if (taskText.includes('pdf')) {
        proposedSkillName = 'pdf_extractor';
        proposedCategory = 'extractor';
        proposedPurpose = 'Robust structured extraction and comparison of PDF tables and sections';
      } else if (taskText.includes('table') || taskText.includes('csv')) {
        proposedSkillName = 'table_structured_parser';
        proposedCategory = 'parser';
        proposedPurpose = 'Parse and normalize varied tabular data into strict JSON records';
      } else {
        proposedSkillName = `skill_${Date.now().toString(36)}`;
        proposedCategory = 'workflow';
        proposedPurpose = `Autonomous skill to accomplish: ${ctx.task.slice(0, 80)}`;
      }
    }
    // 2. Check for tool selector/resilience failure
    else if (errorText.includes('selector') || errorText.includes('dom') || errorText.includes('element not found')) {
      classification = 'TOOL_INSUFFICIENT';
      proposedSkillName = 'resilient_dom_selector';
      proposedCategory = 'adapter';
      proposedPurpose = 'Multi-fallback selector engine with semantic text and accessibility matching';
    }
    // 3. Routing or prompt issue
    else if (ctx.userCorrection && ctx.userCorrection.includes('wrong tool')) {
      classification = 'ROUTING_MISMATCH';
      return null; // Route problem, do not build new tool
    } else if (errorText.includes('timeout') || errorText.includes('network') || errorText.includes('502')) {
      classification = 'TRANSIENT_NETWORK_ERROR';
      return null; // Transient network error, do not build new tool
    }

    const gap: CapabilityGap = {
      id: `gap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      detectedAt: Date.now(),
      source: 'failure_analysis',
      classification,
      taskDescription: ctx.task,
      errorObserved: ctx.error,
      recurringCount: 1,
      proposedSkillName,
      proposedCategory,
      proposedPurpose,
      status: 'IDENTIFIED',
    };

    this.recordGap(gap);
    return gap;
  }

  /**
   * Extract reusable skills from successful high-complexity tasks.
   * e.g. query decomposition -> parallel search -> official source filter -> synthesis.
   */
  static extractFromSuccess(ctx: TaskOutcomeContext): CapabilityGap | null {
    if (!ctx.success || ctx.stepsCount < 3) return null;

    const taskText = ctx.task.toLowerCase();

    // Check if task pattern is reusable
    let proposedSkillName = '';
    let proposedCategory: SkillCategory = 'workflow';
    let proposedPurpose = '';
    let reusablePattern = '';

    if (ctx.toolsInvoked && ctx.toolsInvoked.includes('search') && ctx.stepsCount >= 3) {
      proposedSkillName = 'deep_research_synthesizer';
      proposedCategory = 'research';
      proposedPurpose = 'Multi-hop research query decomposition, cross-source verification, and synthesis';
      reusablePattern = 'decompose -> search_in_parallel -> verify_sources -> synthesize_with_citations';
    } else if (taskText.includes('scrape') || taskText.includes('article') || taskText.includes('fetch')) {
      proposedSkillName = 'article_clean_extractor';
      proposedCategory = 'extractor';
      proposedPurpose = 'Extract clean readable article text and metadata stripped of navigation & ads';
      reusablePattern = 'fetch_html -> strip_noise -> isolate_article_body -> normalize_markdown';
    } else if (taskText.includes('repo') || taskText.includes('test') || taskText.includes('inspect')) {
      proposedSkillName = 'repository_health_inspector';
      proposedCategory = 'validator';
      proposedPurpose = 'Automated repository health check: inspect tests, identify failures, summarize errors';
      reusablePattern = 'scan_workspace -> execute_tests -> parse_failures -> recommend_fixes';
    } else {
      return null; // One-off success without generalizable pattern
    }

    const gap: CapabilityGap = {
      id: `gap_extract_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      detectedAt: Date.now(),
      source: 'workflow_extraction',
      classification: 'CAPABILITY_MISSING',
      taskDescription: ctx.task,
      recurringCount: 1,
      proposedSkillName,
      proposedCategory,
      proposedPurpose,
      reusablePattern,
      status: 'IDENTIFIED',
    };

    this.recordGap(gap);
    return gap;
  }

  private static recordGap(gap: CapabilityGap) {
    const existing = this.detectedGaps.find(
      (g) => g.proposedSkillName === gap.proposedSkillName || g.proposedPurpose === gap.proposedPurpose
    );
    if (existing) {
      existing.recurringCount++;
      existing.detectedAt = Date.now();
    } else {
      this.detectedGaps.unshift(gap);
    }
  }

  static getIdentifiedGaps(): CapabilityGap[] {
    return this.detectedGaps.filter((g) => g.status === 'IDENTIFIED');
  }

  static markGapStatus(id: string, status: CapabilityGap['status']) {
    const g = this.detectedGaps.find((item) => item.id === id);
    if (g) g.status = status;
  }
}
