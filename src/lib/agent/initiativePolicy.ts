// Initiative action-class policy.
// Authorization is NEVER derived from confidence alone.

export type ActionClass =
  | 'READ_ONLY'
  | 'REVERSIBLE'
  | 'LOW_IMPACT'
  | 'EXTERNAL_SIDE_EFFECT'
  | 'DESTRUCTIVE'
  | 'FINANCIAL'
  | 'ACCOUNT_SECURITY'
  | 'SECURITY_SENSITIVE'
  | 'PRIVACY_SENSITIVE';

export type PolicyDecision = 'AUTO_ACT' | 'RECOMMEND' | 'ASK' | 'BLOCK';

export type UserAutonomyPreference = 'autonomy_on' | 'ask_always' | 'quiet';

export type PermissionScope =
  | 'none'
  | 'workspace_read'
  | 'workspace_write'
  | 'network'
  | 'credentials'
  | 'billing'
  | 'privacy';

export interface ActionPolicyInput {
  relevance: number;
  usefulness: number;
  capabilityAvailable: boolean;
  permissionScope: PermissionScope;
  reversibility: 'none' | 'easy' | 'hard';
  actionClass: ActionClass;
  userPreference: UserAutonomyPreference;
  resourceBudgetOk: boolean;
  requiredAuthorization: 'none' | 'user_confirm' | 'security_owner';
  preAuthorized?: boolean;
  /** Quality signal only — never sufficient authorization. */
  confidence?: number;
}

export interface ActionPolicyResult {
  decision: PolicyDecision;
  actionClass: ActionClass;
  rationale: string;
  authorizedByPolicy: boolean;
  confidenceUsedAsGate: false;
}

const SENSITIVE: ActionClass[] = [
  'DESTRUCTIVE',
  'FINANCIAL',
  'ACCOUNT_SECURITY',
  'SECURITY_SENSITIVE',
  'PRIVACY_SENSITIVE',
];

export function evaluateActionPolicy(input: ActionPolicyInput): ActionPolicyResult {
  const confidenceUsedAsGate = false as const;

  if (!input.capabilityAvailable) {
    return {
      decision: 'BLOCK',
      actionClass: input.actionClass,
      rationale: 'Required capability is not available; refusing to expand scope.',
      authorizedByPolicy: false,
      confidenceUsedAsGate,
    };
  }

  if (!input.resourceBudgetOk) {
    return {
      decision: 'RECOMMEND',
      actionClass: input.actionClass,
      rationale: 'Resource budget exhausted; defer autonomous execution.',
      authorizedByPolicy: false,
      confidenceUsedAsGate,
    };
  }

  if (input.relevance < 0.45 || input.usefulness < 0.4) {
    return {
      decision: 'BLOCK',
      actionClass: input.actionClass,
      rationale: 'Low relevance or usefulness relative to interruption cost.',
      authorizedByPolicy: false,
      confidenceUsedAsGate,
    };
  }

  if (input.userPreference === 'quiet' && input.actionClass !== 'READ_ONLY') {
    return {
      decision: 'RECOMMEND',
      actionClass: input.actionClass,
      rationale: 'User preference is quiet; surface a recommendation instead of acting.',
      authorizedByPolicy: false,
      confidenceUsedAsGate,
    };
  }

  if (input.userPreference === 'ask_always' && input.actionClass !== 'READ_ONLY') {
    return {
      decision: 'ASK',
      actionClass: input.actionClass,
      rationale: 'User policy requires confirmation before autonomous action.',
      authorizedByPolicy: false,
      confidenceUsedAsGate,
    };
  }

  if (SENSITIVE.includes(input.actionClass)) {
    if (input.actionClass === 'ACCOUNT_SECURITY' || input.actionClass === 'SECURITY_SENSITIVE') {
      if (input.requiredAuthorization !== 'security_owner' && !input.preAuthorized) {
        return {
          decision: 'BLOCK',
          actionClass: input.actionClass,
          rationale: 'Security or credential changes cannot proceed without owner authorization.',
          authorizedByPolicy: false,
          confidenceUsedAsGate,
        };
      }
      return {
        decision: 'ASK',
        actionClass: input.actionClass,
        rationale: 'Security-sensitive action requires explicit confirmation.',
        authorizedByPolicy: false,
        confidenceUsedAsGate,
      };
    }

    if (input.actionClass === 'FINANCIAL' || input.actionClass === 'DESTRUCTIVE') {
      return {
        decision: 'ASK',
        actionClass: input.actionClass,
        rationale: `${input.actionClass} actions require explicit user confirmation.`,
        authorizedByPolicy: false,
        confidenceUsedAsGate,
      };
    }

    if (input.actionClass === 'PRIVACY_SENSITIVE' && !input.preAuthorized) {
      return {
        decision: 'ASK',
        actionClass: input.actionClass,
        rationale: 'Privacy-sensitive storage or sharing requires user-controlled consent.',
        authorizedByPolicy: false,
        confidenceUsedAsGate,
      };
    }
  }

  if (input.actionClass === 'EXTERNAL_SIDE_EFFECT' && !input.preAuthorized) {
    return {
      decision: 'ASK',
      actionClass: input.actionClass,
      rationale: 'External side effects (email, messages, posts) require pre-authorization or ASK.',
      authorizedByPolicy: false,
      confidenceUsedAsGate,
    };
  }

  if (input.requiredAuthorization === 'user_confirm' && !input.preAuthorized) {
    return {
      decision: 'ASK',
      actionClass: input.actionClass,
      rationale: 'Policy requires user confirmation for this action class.',
      authorizedByPolicy: false,
      confidenceUsedAsGate,
    };
  }

  if (input.actionClass === 'DESTRUCTIVE' || input.reversibility === 'none') {
    if (input.permissionScope === 'workspace_write' && input.preAuthorized && input.reversibility === 'easy') {
      // unreachable for DESTRUCTIVE, kept for reversibility branch below
    }
    if (input.reversibility === 'none' && input.actionClass !== 'READ_ONLY' && input.actionClass !== 'LOW_IMPACT' && input.actionClass !== 'REVERSIBLE') {
      return {
        decision: 'ASK',
        actionClass: input.actionClass,
        rationale: 'Irreversible action cannot AUTO_ACT.',
        authorizedByPolicy: false,
        confidenceUsedAsGate,
      };
    }
  }

  const writeOk =
    input.permissionScope === 'workspace_write' ||
    input.permissionScope === 'workspace_read' && input.actionClass === 'READ_ONLY';

  if (input.actionClass === 'READ_ONLY') {
    return {
      decision: 'AUTO_ACT',
      actionClass: input.actionClass,
      rationale: 'Read-only inspection is permitted.',
      authorizedByPolicy: true,
      confidenceUsedAsGate,
    };
  }

  if (
    (input.actionClass === 'REVERSIBLE' || input.actionClass === 'LOW_IMPACT') &&
    input.reversibility === 'easy' &&
    (input.permissionScope === 'workspace_write' || writeOk)
  ) {
    return {
      decision: 'AUTO_ACT',
      actionClass: input.actionClass,
      rationale: 'Reversible in-scope workspace action authorized by policy, not confidence.',
      authorizedByPolicy: true,
      confidenceUsedAsGate,
    };
  }

  return {
    decision: 'RECOMMEND',
    actionClass: input.actionClass,
    rationale: 'Default conservative path: recommend rather than silently act.',
    authorizedByPolicy: false,
    confidenceUsedAsGate,
  };
}

export function classifyProposedAction(action: string): ActionClass {
  const a = action.toLowerCase();
  if (/password|credential|auth|2fa|permission|owner/.test(a)) return 'ACCOUNT_SECURITY';
  if (/purchase|pay|invoice|billing|checkout/.test(a)) return 'FINANCIAL';
  if (/delete|rm |wipe|destroy/.test(a)) return 'DESTRUCTIVE';
  if (/email|send message|post |tweet|publish/.test(a)) return 'EXTERNAL_SIDE_EFFECT';
  if (/privacy|pii|personal memory|contact/.test(a)) return 'PRIVACY_SENSITIVE';
  if (/report|presentation|draft|organize files|pptx|docx/.test(a)) return 'REVERSIBLE';
  if (/read|inspect|status|list/.test(a)) return 'READ_ONLY';
  return 'LOW_IMPACT';
}
