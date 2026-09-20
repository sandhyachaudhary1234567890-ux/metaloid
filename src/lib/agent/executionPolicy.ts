// "Just Do It" Autonomous Execution Policy (§40)
// Execution Policy governing when the agent proceeds silently vs when it must consult the user.
// Policy Principle: Silently accomplish all intermediate work (research, code, test, visual QA, repair).
// Speak up ONLY when:
// 1. BLOCKED (cannot recover autonomously after retry)
// 2. IRREVERSIBLY CONSEQUENTIAL (destructive filesystem/external deletion)
// 3. GENUINELY AMBIGUOUS (materially affects outcome between two mutually exclusive directions)
// 4. FINISHED (delivering verified outcome)

export type UserInterruptionTrigger =
  | 'BLOCKED'
  | 'CONSEQUENTIAL_ACTION'
  | 'CRITICAL_AMBIGUITY'
  | 'TASK_COMPLETED';

export interface PolicyEvaluation {
  shouldInterruptUser: boolean;
  trigger?: UserInterruptionTrigger;
  reason?: string;
  proposedActionToConfirm?: string;
}

export class AutonomousExecutionPolicy {
  /**
   * Evaluates whether an agent action requires interrupting the user or should execute silently.
   */
  static evaluateStep(params: {
    action: string;
    isDestructive?: boolean;
    consequentialTarget?: string;
    hasAmbiguity?: boolean;
    ambiguityDetails?: string;
    isBlocked?: boolean;
    blockReason?: string;
    isFinalStep?: boolean;
  }): PolicyEvaluation {
    // 1. Destructive or Irreversible external consequence -> ALWAYS consult user
    if (params.isDestructive) {
      return {
        shouldInterruptUser: true,
        trigger: 'CONSEQUENTIAL_ACTION',
        reason: `Action "${params.action}" is destructive on ${params.consequentialTarget || 'system'}. Requires explicit user approval.`,
        proposedActionToConfirm: params.action,
      };
    }

    // 2. Hard block that cannot be resolved autonomously -> Consult user
    if (params.isBlocked) {
      return {
        shouldInterruptUser: true,
        trigger: 'BLOCKED',
        reason: params.blockReason || `Agent reached an unrecoverable block during "${params.action}".`,
      };
    }

    // 3. Material Ambiguity that cannot be resolved from context -> Consult user
    if (params.hasAmbiguity && params.ambiguityDetails) {
      return {
        shouldInterruptUser: true,
        trigger: 'CRITICAL_AMBIGUITY',
        reason: params.ambiguityDetails,
      };
    }

    // 4. Final step completed -> Speak up with deliverable
    if (params.isFinalStep) {
      return {
        shouldInterruptUser: true,
        trigger: 'TASK_COMPLETED',
        reason: 'Autonomous task execution and multi-facet verification complete.',
      };
    }

    // 5. Normal intermediate step -> JUST DO IT (Silently execute without cognitive friction)
    return {
      shouldInterruptUser: false,
    };
  }
}
