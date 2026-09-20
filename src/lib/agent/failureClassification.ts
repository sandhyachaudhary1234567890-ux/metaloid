export type FailureClass =
  | 'TRANSIENT'
  | 'RETRYABLE'
  | 'USER_ACTION_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'CAPABILITY_MISSING'
  | 'POLICY_BLOCKED'
  | 'PERMANENT_FAILURE';

export interface ClassifiedFailure {
  classification: FailureClass;
  retryable: boolean;
  nextBackoffMs: number;
  maxAttempts: number;
  userMessage: string;
}

const MAX_ATTEMPTS: Record<FailureClass, number> = {
  TRANSIENT: 3,
  RETRYABLE: 3,
  USER_ACTION_REQUIRED: 0,
  AUTH_REQUIRED: 0,
  CAPABILITY_MISSING: 0,
  POLICY_BLOCKED: 0,
  PERMANENT_FAILURE: 0,
};

export function classifyFailure(error: string): FailureClass {
  const e = error.toLowerCase();
  if (/policy|blocked|forbidden scope/.test(e)) return 'POLICY_BLOCKED';
  if (/auth|unauthorized|401|403|credential/.test(e)) return 'AUTH_REQUIRED';
  if (/capability missing|not available|unsupported/.test(e)) return 'CAPABILITY_MISSING';
  if (/permission|confirm|user must/.test(e)) return 'USER_ACTION_REQUIRED';
  if (/timeout|econnreset|network|temporar|429|503/.test(e)) return 'TRANSIENT';
  if (/fail|error/.test(e)) return 'RETRYABLE';
  return 'PERMANENT_FAILURE';
}

export function planRetry(classification: FailureClass, attempt: number): ClassifiedFailure {
  const maxAttempts = MAX_ATTEMPTS[classification];
  const retryable = attempt < maxAttempts;
  const nextBackoffMs = retryable ? Math.min(8000, 250 * 2 ** attempt) : 0;
  const userMessage =
    classification === 'TRANSIENT' || classification === 'RETRYABLE'
      ? retryable
        ? 'I found a problem and I\'m fixing it.'
        : 'I could not recover this automatically.'
      : classification === 'AUTH_REQUIRED'
        ? 'This needs a sign-in before I can continue.'
        : classification === 'POLICY_BLOCKED'
          ? 'I stopped because this action is not allowed.'
          : 'This needs your input before I continue.';

  return { classification, retryable, nextBackoffMs, maxAttempts, userMessage };
}
