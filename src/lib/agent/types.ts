// Universal AgentRuntime Architecture Types (§4, §5, §40)
// Coordinates Context, Planning, Capability Routing, Execution, Checkpointing, and Artifact Generation.

export type TaskStatus =
  | 'QUEUED'
  | 'ANALYZING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'FAILED'
  | 'PAUSED';

export type StepType =
  | 'UNDERSTAND'
  | 'RESEARCH'
  | 'INSPECT'
  | 'CODE_EDIT'
  | 'TEST_EXECUTION'
  | 'VISUAL_QA'
  | 'DOCUMENT_GENERATION'
  | 'REPORT_SYNTHESIS';

export interface AgentStep {
  id: string;
  type: StepType;
  label: string;
  detail: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  output?: unknown;
  error?: string;
  retries: number;
}

export interface TaskArtifact {
  id: string;
  name: string;
  type: 'presentation' | 'report' | 'code' | 'diff' | 'data' | 'visual_qa';
  format: 'pptx' | 'pdf' | 'md' | 'json' | 'html';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  verified: boolean;
}

export interface TaskCheckpoint {
  taskId: string;
  objective: string;
  status: TaskStatus;
  currentStepIndex: number;
  steps: AgentStep[];
  artifacts: TaskArtifact[];
  context: {
    origin: 'chat' | 'voice' | 'mobile_companion' | 'mission_control';
    workingDirectory?: string;
    targetDomain?: string;
    userPreferences?: Record<string, unknown>;
  };
  telemetry: {
    resumedCount: number;
    errorCount: number;
    lastHeartbeat: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface SlideContent {
  slideNumber: number;
  title: string;
  subtitle?: string;
  bulletPoints: string[];
  visualSpec?: {
    type: 'chart' | 'diagram' | 'metric' | 'card_grid';
    data: unknown;
  };
  speakerNotes: string;
  qaPassed?: boolean;
  qaNotes?: string;
}

export interface PresentationDeck {
  deckId: string;
  title: string;
  subtitle: string;
  author: string;
  sourceReferences: string[];
  slides: SlideContent[];
  totalSlides: number;
  visualQAPassed: boolean;
}

export interface CompanionCommand {
  commandId: string;
  source: 'mobile_voice' | 'mobile_call' | 'remote_companion';
  action: 'build_and_test' | 'code_fix' | 'visual_inspect' | 'deep_research';
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface CompanionExecutionTelemetry {
  commandId: string;
  status: 'started' | 'building' | 'testing' | 'error_detected' | 'auto_fixing' | 'rebuilding' | 'success' | 'failed';
  currentStep: string;
  outputLog: string[];
  completedAt?: number;
}
