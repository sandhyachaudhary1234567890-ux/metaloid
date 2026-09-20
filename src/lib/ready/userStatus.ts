// Concise natural status copy. No subsystem jargon.

export type UserStatusKind =
  | 'on_it'
  | 'researching'
  | 'checking'
  | 'verifying'
  | 'done'
  | 'noticed'
  | 'fixing'
  | 'stopped'
  | 'blocked';

const COPY: Record<UserStatusKind, string> = {
  on_it: "I'm on it.",
  researching: 'Researching.',
  checking: 'Checking the result.',
  verifying: 'Verifying the file.',
  done: 'Done.',
  noticed: 'MetaIoid noticed…',
  fixing: "I found a problem and I'm fixing it.",
  stopped: 'Stopped. Completed work is saved.',
  blocked: 'I need your go-ahead before continuing.',
};

export class UserFacingStatus {
  static phrase(kind: UserStatusKind): string {
    return COPY[kind];
  }

  static forInitiative(status: string): string {
    switch (status) {
      case 'RUNNING':
      case 'APPROVED_BY_POLICY':
        return COPY.on_it;
      case 'VERIFYING':
        return COPY.verifying;
      case 'COMPLETED':
        return COPY.done;
      case 'FAILED':
        return COPY.fixing;
      case 'BLOCKED':
      case 'RECOMMENDED':
        return COPY.blocked;
      case 'CANCELLED':
        return COPY.stopped;
      default:
        return COPY.on_it;
    }
  }
}
