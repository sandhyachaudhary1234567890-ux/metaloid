// Canonical enum vocabularies for account data.
//
// These are not stylistic preferences: the Postgres tables carry CHECK
// constraints on exactly these values, so a driver that writes anything else
// gets a 23514 from the database. The local driver would happily accept a
// wrong value and the divergence would only appear in production — which is
// the class of bug this file exists to prevent.
//
// Both drivers normalise through here, and `normalize` is deliberately
// forgiving about *aliases* while remaining strict about *outcomes*: a client
// sending "complete" gets "completed" rather than a 500, but a client sending
// something meaningless is rejected instead of silently coerced.

export const TASK_STATUS = Object.freeze(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);
export const MESSAGE_STATUS = Object.freeze(['streaming', 'complete', 'cancelled', 'error']);
export const MESSAGE_ROLE = Object.freeze(['user', 'assistant', 'tool', 'system']);
export const TOOL_STATE = Object.freeze(['running', 'done', 'error']);
export const USAGE_STATUS = Object.freeze(['ok', 'error', 'cancelled']);
export const CREDENTIAL_STATUS = Object.freeze(['unverified', 'connected', 'invalid']);
export const ATTACHMENT_STATUS = Object.freeze(['pending', 'ready', 'failed']);
export const MEMORY_KIND = Object.freeze(['explicit', 'project', 'conversation', 'preference', 'inferred']);

/** Aliases clients legitimately send, mapped onto the stored vocabulary. */
const TASK_ALIASES = {
  complete: 'completed', done: 'completed', success: 'completed', succeeded: 'completed', finished: 'completed',
  error: 'failed', failure: 'failed', started: 'running', in_progress: 'running', canceled: 'cancelled',
  cancel: 'cancelled', stop: 'cancelled', stopped: 'cancelled', idle: 'queued', created: 'queued', pending: 'queued',
};

/** Statuses that mean the task is over — used to stamp `completed_at`. */
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * @returns {string|null} the canonical status, or null when it is not a
 *   status we can store. Callers turn null into an `invalid_input` error
 *   rather than writing a value the database will reject.
 */
export function normalizeTaskStatus(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (TASK_STATUS.includes(key)) return key;
  return TASK_ALIASES[key] || null;
}

export const isTerminalTaskStatus = (status) => TERMINAL.has(status);

/** True when the status means the task is over. */
export function taskIsFinished(status) {
  const canonical = normalizeTaskStatus(status);
  return canonical ? TERMINAL.has(canonical) : false;
}
