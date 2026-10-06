// MetaIoid Pulse — "what matters right now?"
//
// Pulse is a filter, not a feed. It reads real state (unfinished local work,
// gateway missions, failures) and returns at most a couple of things worth
// interrupting for. When there is nothing worth saying it returns an empty
// list and the home screen stays clean — a quiet home is a feature.
//
// The scoring rule is the product's: importance × confidence × usefulness ×
// timing × permission. Low value stays silent; high value is surfaced; a
// side-effecting action is only ever offered, never performed silently.

import type { TaskCheckpoint } from '../agent/types';

export type PulseKind =
  | 'unfinished'   // work that stopped part-way and can be picked up
  | 'failed'       // something broke and needs a decision
  | 'blocked'      // a mission cannot continue without the user
  | 'running'      // work in progress right now
  | 'completed';   // work that finished since the user was last here

export type PulseAction =
  | { kind: 'open-tasks' }
  | { kind: 'open-mission'; missionId: string }
  | { kind: 'resume-mission'; missionId: string }
  | { kind: 'continue-chat'; prompt: string }
  | { kind: 'connect' };

export interface PulseItem {
  id: string;
  kind: PulseKind;
  /** The eyebrow. One of three phrases, used sparingly. */
  label: string;
  /** One sentence. No subsystem names, no log lines. */
  body: string;
  actionLabel: string;
  action: PulseAction;
  /** Sort key. Higher wins; only the top few are ever shown. */
  weight: number;
  /** When this became true, for ordering and for the "since you left" copy. */
  at: number;
}

/** Nothing below this is worth the interruption. */
const SURFACE_THRESHOLD = 40;
/** The home screen shows at most this many. */
export const PULSE_LIMIT = 2;

/**
 * The eyebrows. Three of them are ordinary; `failed` carries the product's
 * signature phrase, which is reserved for the one case where MetaIoid has
 * actually diagnosed something rather than merely reported a state.
 */
const LABEL: Record<PulseKind, string> = {
  unfinished: 'Pick up where you left off',
  failed: 'MetaIoid noticed…',
  blocked: 'Needs your decision',
  running: 'In progress',
  completed: 'Finished while you were away',
};

function firstFailedStep(task: TaskCheckpoint) {
  return task.steps.find((s) => s.status === 'failed');
}

/**
 * The step work should resume from: the first one that is not already done.
 * `currentStepIndex` is not reliable here — a recovered task keeps the index
 * of the step it was on when the tab closed, which may already be complete.
 */
function nextStep(task: TaskCheckpoint) {
  return task.steps.find((s) => s.status !== 'completed')?.label;
}

function progress(task: TaskCheckpoint): number {
  if (!task.steps.length) return 0;
  const done = task.steps.filter((s) => s.status === 'completed').length;
  return Math.round((done / task.steps.length) * 100);
}

/**
 * Local work — checkpoints the browser still holds.
 *
 * A task that was in flight when the tab closed is recovered on boot as
 * RECOVERING: it is genuinely unfinished, and saying so is the single most
 * useful thing the home screen can do.
 */
export function pulseFromTasks(tasks: TaskCheckpoint[], now = Date.now()): PulseItem[] {
  const out: PulseItem[] = [];

  for (const task of tasks) {
    const failed = firstFailedStep(task);

    if (failed) {
      out.push({
        id: `pulse-failed-${task.taskId}`,
        kind: 'failed',
        label: LABEL.failed,
        body: `“${task.objective}” stopped at ${failed.label}. ${failed.error ? failed.error : 'I can pick it up from there.'}`,
        actionLabel: 'Review',
        action: { kind: 'open-tasks' },
        weight: 90,
        at: failed.completedAt ?? task.updatedAt ?? now,
      });
      continue;
    }

    if (task.status === 'RECOVERING' || task.status === 'PAUSED') {
      const step = nextStep(task);
      out.push({
        id: `pulse-unfinished-${task.taskId}`,
        kind: 'unfinished',
        label: LABEL.unfinished,
        body: step
          ? `We stopped on “${task.objective}”. Next up: ${step}.`
          : `“${task.objective}” is still open.`,
        actionLabel: 'Continue',
        action: { kind: 'continue-chat', prompt: `Continue: ${task.objective}` },
        weight: 80,
        at: task.updatedAt ?? now,
      });
      continue;
    }

    if (['ANALYZING', 'PLANNING', 'EXECUTING', 'VERIFYING'].includes(task.status)) {
      out.push({
        id: `pulse-running-${task.taskId}`,
        kind: 'running',
        label: LABEL.running,
        body: `Working on “${task.objective}” — ${progress(task)}% done.`,
        actionLabel: 'Watch',
        action: { kind: 'open-tasks' },
        weight: 60,
        at: task.updatedAt ?? now,
      });
    }
  }

  return out;
}

/** A gateway mission, in Pulse's shape. Timestamps may arrive as ISO text. */
export interface MissionPulseInput {
  id: string;
  objective: string;
  status: string;
  tasks: { status: string }[];
  updatedAt?: number | string;
  createdAt?: number | string;
}

function toTime(value: number | string | undefined, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

export function pulseFromMissions(missions: MissionPulseInput[], now = Date.now()): PulseItem[] {
  const out: PulseItem[] = [];

  for (const m of missions) {
    const done = m.tasks.filter((t) => t.status === 'COMPLETED').length;
    const total = m.tasks.length || 1;
    const pct = Math.round((done / total) * 100);
    const at = toTime(m.updatedAt ?? m.createdAt, now);

    if (m.status === 'FAILED') {
      out.push({
        id: `pulse-mission-failed-${m.id}`,
        kind: 'failed',
        label: LABEL.failed,
        body: `“${m.objective}” did not finish. ${done} of ${total} steps are complete.`,
        actionLabel: 'Review',
        action: { kind: 'open-mission', missionId: m.id },
        weight: 88,
        at,
      });
    } else if (m.status === 'BLOCKED') {
      out.push({
        id: `pulse-mission-blocked-${m.id}`,
        kind: 'blocked',
        label: LABEL.blocked,
        body: `“${m.objective}” is waiting on you before it can continue.`,
        actionLabel: 'Open',
        action: { kind: 'open-mission', missionId: m.id },
        weight: 85,
        at,
      });
    } else if (m.status === 'PAUSED') {
      out.push({
        id: `pulse-mission-paused-${m.id}`,
        kind: 'unfinished',
        label: LABEL.unfinished,
        body: `“${m.objective}” is paused at ${pct}%.`,
        actionLabel: 'Resume',
        action: { kind: 'resume-mission', missionId: m.id },
        weight: 78,
        at,
      });
    } else if (m.status === 'RUNNING') {
      out.push({
        id: `pulse-mission-running-${m.id}`,
        kind: 'running',
        label: LABEL.running,
        body: `“${m.objective}” — ${pct}% complete.`,
        actionLabel: 'Watch',
        action: { kind: 'open-mission', missionId: m.id },
        weight: 58,
        at,
      });
    } else if (m.status === 'COMPLETED') {
      out.push({
        id: `pulse-mission-completed-${m.id}`,
        kind: 'completed',
        label: LABEL.completed,
        body: `“${m.objective}” finished. It has not been verified yet.`,
        actionLabel: 'Verify',
        action: { kind: 'open-mission', missionId: m.id },
        weight: 70,
        at,
      });
    }
  }

  return out;
}

/**
 * Merge, de-duplicate and rank. The aggressive part of the filter lives here:
 * anything under the threshold is dropped rather than ranked last, so a busy
 * day cannot slowly turn the home screen into a notification tray.
 */
export function rankPulse(...groups: PulseItem[][]): PulseItem[] {
  const seen = new Set<string>();
  const merged: PulseItem[] = [];

  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged
    .filter((i) => i.weight >= SURFACE_THRESHOLD)
    .sort((a, b) => b.weight - a.weight || b.at - a.at)
    .slice(0, PULSE_LIMIT + 1);
}
