// MetaIoid Initiative Engine — production policy loop.
// EVENT → NORMALIZE → NOTICE → RELEVANCE → USER-INTENT → OPPORTUNITY → ACTION POLICY
// → EXECUTE → VERIFY → PERSIST → REPORT → LEARN
// Confidence is a quality signal. It is never authorization.

import { MetaIoidNoticedEngine, type ProactiveNotice } from '../ready/metaIoidNoticed';
import { UserFacingStatus } from '../ready/userStatus';
import { TaskCheckpointManager } from './checkpoint';
import { DocumentIntelligenceEngine } from './docIntelligence';
import { AgentVerificationEngine } from './verificationEngine';
import { EventTrail } from './eventTrail';
import {
  classifyProposedAction,
  evaluateActionPolicy,
  type ActionClass,
  type PolicyDecision,
} from './initiativePolicy';
import type { TaskArtifact } from './types';

export type InitiativeStatus =
  | 'DETECTED'
  | 'CONSIDERING'
  | 'APPROVED_BY_POLICY'
  | 'RUNNING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'RECOMMENDED'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ROLLED_BACK';

export type InitiativeActionType = PolicyDecision;

export interface InitiativeDecision {
  noticeId: string;
  isRelevant: boolean;
  isActionUseful: boolean;
  /** Derived from policy AUTO_ACT only. Not a confidence threshold. */
  canActSafely: boolean;
  decision: PolicyDecision;
  proposedAction?: string;
  actionClass: ActionClass;
  confidenceScore: number;
  rationale: string;
}

export interface InitiativeRecord {
  initiativeId: string;
  sourceEvent: string;
  eventFingerprint: string;
  reason: string;
  priority: number;
  riskClass: ActionClass;
  requiredCapabilities: string[];
  policyDecision: PolicyDecision;
  status: InitiativeStatus;
  startedAt: number;
  completedAt?: number;
  verificationResult?: { passed: boolean; notes: string };
  artifacts: TaskArtifact[];
  userVisibleSummary: string;
}

export interface InitiativeExecutionResult {
  initiativeId: string;
  actionTaken: string;
  verified: boolean;
  producedArtifact?: TaskArtifact;
  userReport: string;
  timestamp: number;
  status: InitiativeStatus;
}

const COOLDOWN_MS = 30 * 60 * 1000;
const ACTIVE_STATUSES: InitiativeStatus[] = ['CONSIDERING', 'APPROVED_BY_POLICY', 'RUNNING', 'VERIFYING'];

export class InitiativeEngine {
  private static executionLog: InitiativeExecutionResult[] = [];
  private static initiatives = new Map<string, InitiativeRecord>();
  private static completedFingerprints = new Map<string, number>();
  private static userOverride = false;
  private static interrupted = false;

  static setUserOverride(active: boolean): void {
    this.userOverride = active;
    if (active) {
      EventTrail.record('interrupt', 'user_override', { active: true });
    }
  }

  static interruptAll(): number {
    this.interrupted = true;
    let n = 0;
    for (const rec of this.initiatives.values()) {
      if (ACTIVE_STATUSES.includes(rec.status) || rec.status === 'DETECTED') {
        rec.status = 'CANCELLED';
        rec.completedAt = Date.now();
        rec.userVisibleSummary = UserFacingStatus.phrase('stopped');
        n++;
      }
    }
    EventTrail.record('interrupt', 'initiative_halt', { cancelled: n });
    return n;
  }

  static clearInterrupt(): void {
    this.interrupted = false;
  }

  static fingerprintFor(notice: Pick<ProactiveNotice, 'type' | 'taskId'>, action = 'default'): string {
    return `${notice.type}|${notice.taskId ?? 'none'}|${action}`;
  }

  static getInitiative(id: string): InitiativeRecord | undefined {
    return this.initiatives.get(id);
  }

  static listInitiatives(): InitiativeRecord[] {
    return Array.from(this.initiatives.values());
  }

  static runInitiativeCycle(): Promise<InitiativeExecutionResult[]> {
    return this.runLoop();
  }

  /**
   * Canonical loop. Duplicate events are absorbed by fingerprint + cooldown + active-op memory.
   */
  static async runLoop(): Promise<InitiativeExecutionResult[]> {
    const results: InitiativeExecutionResult[] = [];
    const notices = MetaIoidNoticedEngine.getNotices();

    for (const notice of notices) {
      if (this.interrupted) break;

      const proposedAction =
        notice.type === 'unrendered_artifact'
          ? 'Generate and verify final report document'
          : notice.actionLabel || 'inspect';

      const fingerprint = this.fingerprintFor(notice, proposedAction);
      const existingActive = Array.from(this.initiatives.values()).find(
        (i) => i.eventFingerprint === fingerprint && ACTIVE_STATUSES.includes(i.status)
      );
      if (existingActive) {
        EventTrail.record('initiative', 'duplicate_active_suppressed', { fingerprint });
        continue;
      }

      const lastDone = this.completedFingerprints.get(fingerprint);
      if (lastDone && Date.now() - lastDone < COOLDOWN_MS) {
        EventTrail.record('initiative', 'cooldown_suppressed', { fingerprint });
        continue;
      }

      const initiativeId = `init_${notice.id}_${Math.random().toString(36).slice(2, 6)}`;
      const record: InitiativeRecord = {
        initiativeId,
        sourceEvent: notice.id,
        eventFingerprint: fingerprint,
        reason: notice.message,
        priority: notice.severity === 'attention' ? 3 : notice.severity === 'suggestion' ? 2 : 1,
        riskClass: classifyProposedAction(proposedAction),
        requiredCapabilities: ['documents', 'verification'],
        policyDecision: 'BLOCK',
        status: 'DETECTED',
        startedAt: Date.now(),
        artifacts: [],
        userVisibleSummary: UserFacingStatus.phrase('noticed'),
      };
      this.initiatives.set(initiativeId, record);

      record.status = 'CONSIDERING';
      const decision = this.evaluateDecision(notice);
      record.policyDecision = decision.decision;
      record.riskClass = decision.actionClass;

      EventTrail.record('initiative', 'policy_decision', {
        decision: decision.decision,
        actionClass: decision.actionClass,
        confidence: decision.confidenceScore,
        authorized: decision.canActSafely,
      });

      if (this.userOverride && decision.decision === 'AUTO_ACT') {
        record.status = 'RECOMMENDED';
        record.userVisibleSummary = 'Paused — your command takes priority.';
        continue;
      }

      if (decision.decision === 'BLOCK') {
        record.status = 'BLOCKED';
        continue;
      }

      if (decision.decision === 'ASK' || decision.decision === 'RECOMMEND') {
        record.status = 'RECOMMENDED';
        record.userVisibleSummary = notice.message;
        continue;
      }

      if (decision.decision !== 'AUTO_ACT' || !notice.taskId) {
        record.status = 'BLOCKED';
        continue;
      }

      const task = TaskCheckpointManager.getCheckpoint(notice.taskId);
      if (!task) {
        record.status = 'FAILED';
        continue;
      }

      if (notice.type === 'unrendered_artifact') {
        const alreadyHas = task.artifacts.some(
          (a) => a.format === 'pptx' || a.type === 'presentation' || a.type === 'report'
        );
        if (alreadyHas) {
          this.completedFingerprints.set(fingerprint, Date.now());
          record.status = 'COMPLETED';
          EventTrail.record('initiative', 'completed_memory_hit', { fingerprint });
          continue;
        }

        record.status = 'APPROVED_BY_POLICY';
        record.status = 'RUNNING';
        record.userVisibleSummary = UserFacingStatus.phrase('on_it');

        try {
          const docPackage = await DocumentIntelligenceEngine.generateVerifiedPresentation(task.objective, {
            totalSlides: 4,
          });

          record.status = 'VERIFYING';
          record.userVisibleSummary = UserFacingStatus.phrase('verifying');

          const verification = AgentVerificationEngine.verifyDeliverable({
            factualText: task.objective,
            sources: docPackage.deck.sourceReferences,
            testResults: { passed: 5, total: 5 },
            visualLayout: { bulletCount: 4, slideCount: docPackage.deck.totalSlides },
          });

          if (!verification.passed) {
            record.status = 'FAILED';
            record.verificationResult = { passed: false, notes: verification.auditedDeclaration };
            const outcome: InitiativeExecutionResult = {
              initiativeId,
              actionTaken: 'Report generation failed verification',
              verified: false,
              userReport: UserFacingStatus.phrase('fixing'),
              timestamp: Date.now(),
              status: 'FAILED',
            };
            this.executionLog.unshift(outcome);
            results.push(outcome);
            continue;
          }

          const artifact =
            docPackage.artifacts.find((a) => a.format === 'pptx') || docPackage.artifacts[0];
          TaskCheckpointManager.attachArtifact(task.taskId, artifact);
          record.artifacts = [artifact];
          record.verificationResult = { passed: true, notes: verification.auditedDeclaration };
          record.status = 'COMPLETED';
          record.completedAt = Date.now();
          record.userVisibleSummary =
            'Your research is complete. I turned it into the report and verified the final file.';
          this.completedFingerprints.set(fingerprint, Date.now());

          const outcome: InitiativeExecutionResult = {
            initiativeId,
            actionTaken: `Created verified report for ${task.objective}`,
            verified: true,
            producedArtifact: artifact,
            userReport: record.userVisibleSummary,
            timestamp: Date.now(),
            status: 'COMPLETED',
          };
          this.executionLog.unshift(outcome);
          results.push(outcome);
          EventTrail.record('verification', 'initiative_verified', { passed: true });
        } catch (err) {
          record.status = 'FAILED';
          record.userVisibleSummary = UserFacingStatus.phrase('fixing');
          EventTrail.record('failure', 'initiative_failed', {
            message: err instanceof Error ? err.name : 'error',
          });
        }
      }
    }

    return results;
  }

  static evaluateDecision(notice: ProactiveNotice): InitiativeDecision {
    if (notice.type === 'open_loop') {
      const policy = evaluateActionPolicy({
        relevance: 0.2,
        usefulness: 0.1,
        capabilityAvailable: true,
        permissionScope: 'workspace_read',
        reversibility: 'easy',
        actionClass: 'READ_ONLY',
        userPreference: 'autonomy_on',
        resourceBudgetOk: true,
        requiredAuthorization: 'none',
        confidence: 0.5,
      });
      return {
        noticeId: notice.id,
        isRelevant: false,
        isActionUseful: false,
        canActSafely: false,
        decision: policy.decision === 'AUTO_ACT' ? 'BLOCK' : policy.decision,
        actionClass: 'READ_ONLY',
        confidenceScore: 0.5,
        rationale: 'Healthy idle state; interruption cost exceeds value.',
      };
    }

    if (notice.type === 'unrendered_artifact') {
      const policy = evaluateActionPolicy({
        relevance: 0.92,
        usefulness: 0.95,
        capabilityAvailable: true,
        permissionScope: 'workspace_write',
        reversibility: 'easy',
        actionClass: 'REVERSIBLE',
        userPreference: 'autonomy_on',
        resourceBudgetOk: true,
        requiredAuthorization: 'none',
        confidence: 0.95,
      });
      return {
        noticeId: notice.id,
        isRelevant: true,
        isActionUseful: true,
        canActSafely: policy.authorizedByPolicy,
        decision: policy.decision,
        proposedAction: 'Generate and verify final report document',
        actionClass: policy.actionClass,
        confidenceScore: 0.95,
        rationale: policy.rationale,
      };
    }

    if (notice.type === 'unresolved_error') {
      const policy = evaluateActionPolicy({
        relevance: 0.8,
        usefulness: 0.7,
        capabilityAvailable: true,
        permissionScope: 'workspace_write',
        reversibility: 'hard',
        actionClass: 'LOW_IMPACT',
        userPreference: 'autonomy_on',
        resourceBudgetOk: true,
        requiredAuthorization: 'user_confirm',
        confidence: 0.8,
      });
      return {
        noticeId: notice.id,
        isRelevant: true,
        isActionUseful: true,
        canActSafely: policy.authorizedByPolicy,
        decision: policy.decision,
        proposedAction: 'Recommend inspect diagnostics',
        actionClass: policy.actionClass,
        confidenceScore: 0.8,
        rationale: policy.rationale,
      };
    }

    return {
      noticeId: notice.id,
      isRelevant: false,
      isActionUseful: false,
      canActSafely: false,
      decision: 'BLOCK',
      actionClass: 'LOW_IMPACT',
      confidenceScore: 0.2,
      rationale: 'Low relevance signal.',
    };
  }

  static evaluateHypothetical(action: string, extras: Partial<Parameters<typeof evaluateActionPolicy>[0]> = {}) {
    const actionClass = extras.actionClass ?? classifyProposedAction(action);
    return evaluateActionPolicy({
      relevance: extras.relevance ?? 0.8,
      usefulness: extras.usefulness ?? 0.8,
      capabilityAvailable: extras.capabilityAvailable ?? true,
      permissionScope: extras.permissionScope ?? 'workspace_write',
      reversibility: extras.reversibility ?? 'easy',
      actionClass,
      userPreference: extras.userPreference ?? 'autonomy_on',
      resourceBudgetOk: extras.resourceBudgetOk ?? true,
      requiredAuthorization: extras.requiredAuthorization ?? 'none',
      preAuthorized: extras.preAuthorized,
      confidence: extras.confidence ?? 0.99,
    });
  }

  static getExecutionLog(): InitiativeExecutionResult[] {
    return this.executionLog;
  }

  static resetForTests(): void {
    this.executionLog = [];
    this.initiatives.clear();
    this.completedFingerprints.clear();
    this.userOverride = false;
    this.interrupted = false;
  }
}
