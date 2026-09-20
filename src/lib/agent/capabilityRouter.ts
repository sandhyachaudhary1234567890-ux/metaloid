// Capability Router (§4, §5, §40)
// Intelligently routes high-level tasks to appropriate core capabilities:
// Voice, Vision, Research, Code, Files & Document Intelligence.

export type TargetCapability = 'voice' | 'vision' | 'research' | 'code' | 'files_docs' | 'hybrid';

export interface RouteDecision {
  capability: TargetCapability;
  confidence: number;
  toolsRequired: string[];
  executionPlan: string[];
  isAutonomousMultiStep: boolean;
}

export class CapabilityRouter {
  /**
   * Route user instruction to capability domain and sequence execution plan.
   */
  static route(intent: string): RouteDecision {
    const raw = intent.toLowerCase().trim();

    // 1. Presentation & Document Generation (Killer test archetype)
    if (
      raw.includes('presentation') ||
      raw.includes('pptx') ||
      raw.includes('slides') ||
      raw.includes('document generation') ||
      raw.includes('deck')
    ) {
      return {
        capability: 'files_docs',
        confidence: 0.98,
        toolsRequired: ['research_synthesizer', 'slide_generator', 'visual_qa_validator', 'doc_exporter'],
        executionPlan: [
          'Decompose topic and extract verified facts',
          'Draft structured multi-slide deck with speaker notes',
          'Run autonomous Visual QA to detect text overflow or clipping',
          'Auto-correct slide density and balance layout',
          'Generate and export Markdown and PPTX artifacts',
        ],
        isAutonomousMultiStep: true,
      };
    }

    // 2. Full Project Audit, Code Fix & Test Execution (Engineering task archetype)
    if (
      raw.includes('check karo') ||
      raw.includes('bugs find karo') ||
      raw.includes('fix karo') ||
      raw.includes('project build') ||
      raw.includes('run tests') ||
      raw.includes('build and test')
    ) {
      return {
        capability: 'code',
        confidence: 0.96,
        toolsRequired: ['repo_scanner', 'test_runner', 'ast_editor', 'companion_bridge'],
        executionPlan: [
          'Inspect project workspace and file tree',
          'Launch tests and detect failure points',
          'Synthesize autonomous patch and apply code fix',
          'Re-verify build and run full test suite',
          'Compile final verification report',
        ],
        isAutonomousMultiStep: true,
      };
    }

    // 3. Deep Research & Fact Verification
    if (
      raw.includes('research') ||
      raw.includes('investigate') ||
      raw.includes('compare') ||
      raw.includes('benchmarks')
    ) {
      return {
        capability: 'research',
        confidence: 0.92,
        toolsRequired: ['deep_research_synthesizer', 'source_verifier'],
        executionPlan: [
          'Decompose topic into parallel sub-queries',
          'Execute targeted searches and filter official docs',
          'Synthesize cross-verified findings with citations',
        ],
        isAutonomousMultiStep: true,
      };
    }

    // 4. Vision & Camera Inspection
    if (raw.includes('look at') || raw.includes('camera') || raw.includes('image') || raw.includes('screen')) {
      return {
        capability: 'vision',
        confidence: 0.9,
        toolsRequired: ['vision_pipeline', 'ocr_extractor'],
        executionPlan: ['Acquire visual frame', 'Analyze spatial elements', 'Synthesize visual breakdown'],
        isAutonomousMultiStep: false,
      };
    }

    // 5. Voice & Spoken Turn
    if (raw.includes('speak') || raw.includes('bolo') || raw.includes('voice')) {
      return {
        capability: 'voice',
        confidence: 0.9,
        toolsRequired: ['voice_runtime', 'speech_chunker', 'tts_stream'],
        executionPlan: ['Engage dynamic endpointing', 'Stream tokens to semantic chunker', 'Prefetch TTS'],
        isAutonomousMultiStep: false,
      };
    }

    // Default: General assistant
    return {
      capability: 'hybrid',
      confidence: 0.8,
      toolsRequired: ['general_assistant'],
      executionPlan: ['Process turn through HumanBehaviorPipeline'],
      isAutonomousMultiStep: false,
    };
  }
}
