// Skill Forge & Self-Improvement System Architecture (§1, §40)
// Separates CORE AGENT from SKILLS, TOOLS, and EXPERIMENTS.
// Enforces isolated worker sandboxing, versioning, canary evaluation, and rollback.

export type SkillStatus = 'STABLE' | 'CANARY' | 'EXPERIMENTAL' | 'DISABLED';

export type SkillCategory =
  | 'parser'
  | 'extractor'
  | 'adapter'
  | 'workflow'
  | 'research'
  | 'connector'
  | 'validator'
  | 'automation';

export interface SkillPermission {
  network: boolean;
  allowedHosts?: string[];
  filesystem: 'none' | 'read_scratch' | 'write_scratch';
  maxExecutionTimeMs: number;
  maxMemoryMb: number;
}

export interface TestCase {
  id: string;
  name: string;
  type: 'unit' | 'edge_case' | 'failure' | 'validation' | 'regression';
  input: Record<string, unknown>;
  expectedOutput?: Record<string, unknown>;
  validatorCode?: string; // JS expression validating output
  shouldFail?: boolean;
}

export interface BenchmarkMetrics {
  accuracy: number; // 0.0 - 1.0
  latencyMs: number;
  memoryKb: number;
  successRate: number; // 0.0 - 1.0
  toolCallsCount: number;
  sampleSize: number;
}

export interface SkillVersion {
  version: string; // e.g. "1.0.0", "1.1.0"
  status: SkillStatus;
  code: string; // Executable pure JavaScript/TypeScript function body
  tests: TestCase[];
  benchmark: BenchmarkMetrics;
  createdAt: number;
  updatedAt: number;
  changelog: string;
  author: 'MetaIoid' | 'developer';
  rollbackVersion?: string;
}

export interface Skill {
  skillId: string;
  name: string;
  category: SkillCategory;
  purpose: string;
  description: string;
  inputs: Record<string, { type: string; description: string; required?: boolean }>;
  outputs: Record<string, { type: string; description: string }>;
  permissions: SkillPermission;
  currentVersion: string;
  versions: Record<string, SkillVersion>;
  tags: string[];
  failureCount: number;
  successCount: number;
  lastUsedAt?: number;
  lastImprovedAt?: number;
}

export type FailureClassification =
  | 'CAPABILITY_MISSING'       // No tool exists to handle this format/action
  | 'TOOL_INSUFFICIENT'        // Tool exists but failed on input/parsing/rate-limit
  | 'ROUTING_MISMATCH'         // Wrong skill or tool was chosen by agent
  | 'PROMPT_UNCLEAR'           // Agent instruction was underspecified
  | 'MODEL_CAPACITY_LIMIT'     // Model hallucinated or context window exceeded
  | 'TRANSIENT_NETWORK_ERROR'; // Ephemeral gateway/network issue

export interface CapabilityGap {
  id: string;
  detectedAt: number;
  source: 'failure_analysis' | 'workflow_extraction' | 'user_request';
  classification: FailureClassification;
  taskDescription: string;
  failedInputs?: Record<string, unknown>;
  errorObserved?: string;
  recurringCount: number;
  proposedSkillName: string;
  proposedCategory: SkillCategory;
  proposedPurpose: string;
  reusablePattern?: string;
  status: 'IDENTIFIED' | 'FORGING' | 'RESOLVED' | 'DISMISSED';
}

export interface SandboxLimits {
  timeoutMs: number;
  maxMemoryBytes: number;
}

export interface SandboxExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  memoryUsedBytes?: number;
  securityViolation?: string;
}

export interface EvaluationReport {
  skillId: string;
  version: string;
  passed: boolean;
  stages: {
    syntaxCheck: boolean;
    securityAudit: boolean;
    unitTests: { passed: number; total: number };
    edgeCaseTests: { passed: number; total: number };
    benchmark: BenchmarkMetrics;
  };
  regressionDetected: boolean;
  recommendation: 'DEPLOY_CANARY' | 'DEPLOY_STABLE' | 'ROLLBACK' | 'REJECT';
  reason: string;
}

export interface SkillAuditLog {
  id: string;
  timestamp: number;
  skillId: string;
  action: 'CREATED' | 'IMPROVED' | 'PROMOTED_STABLE' | 'ROLLED_BACK' | 'DISABLED';
  fromVersion?: string;
  toVersion?: string;
  reason: string;
  benchmarkBefore?: BenchmarkMetrics;
  benchmarkAfter?: BenchmarkMetrics;
  testResultsSummary: string;
}

export interface SelfImprovementReport {
  generatedAt: number;
  newSkillsCreated: string[];
  improvedSkills: string[];
  fixedTools: string[];
  rolledBackVersions: string[];
  performanceGains: { skillId: string; metric: string; improvementPct: number }[];
  failedExperimentsCount: number;
  remainingGaps: string[];
}
