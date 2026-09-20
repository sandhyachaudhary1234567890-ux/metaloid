// Checkpoint & Crash Recovery Engine (§4, §5)
// Serializes task state across phase transitions to survive restarts, browser crashes, or network disconnects.
// On system boot, recovers in-flight tasks and resumes from the last completed step.

import type { TaskCheckpoint, TaskStatus, AgentStep, TaskArtifact } from './types';

const STORAGE_KEY_PREFIX = 'metaloid_checkpoint_';

export class TaskCheckpointManager {
  private static inMemoryStore: Map<string, TaskCheckpoint> = new Map();

  /**
   * Save or update task checkpoint.
   */
  static saveCheckpoint(checkpoint: TaskCheckpoint, touchHeartbeat = false): void {
    if (!checkpoint.updatedAt || touchHeartbeat) {
      checkpoint.updatedAt = Date.now();
    }
    if (!checkpoint.telemetry) {
      checkpoint.telemetry = { resumedCount: 0, errorCount: 0, lastHeartbeat: Date.now() };
    } else if (touchHeartbeat || !checkpoint.telemetry.lastHeartbeat) {
      checkpoint.telemetry.lastHeartbeat = Date.now();
    }
    this.inMemoryStore.set(checkpoint.taskId, checkpoint);

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(
          `${STORAGE_KEY_PREFIX}${checkpoint.taskId}`,
          JSON.stringify(checkpoint)
        );
      } catch {
        // LocalStorage quota or access error - in-memory retains state
      }
    }
  }

  /**
   * Touch heartbeat for a running task.
   */
  static touchHeartbeat(taskId: string): void {
    const cp = this.getCheckpoint(taskId);
    if (cp) {
      cp.telemetry.lastHeartbeat = Date.now();
      cp.updatedAt = Date.now();
      this.saveCheckpoint(cp, true);
    }
  }

  /**
   * Retrieve checkpoint by taskId.
   */
  static getCheckpoint(taskId: string): TaskCheckpoint | null {
    if (this.inMemoryStore.has(taskId)) {
      return this.inMemoryStore.get(taskId)!;
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${taskId}`);
        if (raw) {
          const parsed = JSON.parse(raw) as TaskCheckpoint;
          this.inMemoryStore.set(taskId, parsed);
          return parsed;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private static readonly IN_FLIGHT: TaskStatus[] = [
    'ANALYZING',
    'PLANNING',
    'EXECUTING',
    'VERIFYING',
    'RECOVERING',
  ];

  /**
   * Read-only listing. Does not mutate status (observing is not recovering).
   */
  static listInFlightTasks(opts?: { includePaused?: boolean }): TaskCheckpoint[] {
    const statuses: TaskStatus[] = opts?.includePaused
      ? [...this.IN_FLIGHT, 'PAUSED']
      : this.IN_FLIGHT;
    const found: TaskCheckpoint[] = [];
    for (const cp of this.inMemoryStore.values()) {
      if (statuses.includes(cp.status)) found.push(cp);
    }
    return found;
  }

  /**
   * Crash recovery: mark in-flight work RECOVERING and increment resume count once.
   */
  static recoverPendingTasks(): TaskCheckpoint[] {
    const recovered: TaskCheckpoint[] = [];

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
            const raw = window.localStorage.getItem(key);
            if (raw) {
              const cp = JSON.parse(raw) as TaskCheckpoint;
              if (this.IN_FLIGHT.includes(cp.status) && cp.status !== 'RECOVERING') {
                cp.status = 'RECOVERING';
                cp.telemetry.resumedCount++;
                this.inMemoryStore.set(cp.taskId, cp);
                recovered.push(cp);
              } else if (cp.status === 'RECOVERING' && !recovered.some((r) => r.taskId === cp.taskId)) {
                recovered.push(cp);
              }
            }
          }
        }
      } catch { /* ignore */ }
    }

    for (const cp of this.inMemoryStore.values()) {
      if (this.IN_FLIGHT.includes(cp.status)) {
        if (!recovered.some((r) => r.taskId === cp.taskId)) {
          if (cp.status !== 'RECOVERING') {
            cp.status = 'RECOVERING';
            cp.telemetry.resumedCount++;
          }
          recovered.push(cp);
        }
      }
    }

    return recovered;
  }

  /**
   * Update current step and advance index atomically.
   */
  static advanceStep(
    taskId: string,
    completedStepIndex: number,
    output?: unknown
  ): TaskCheckpoint | null {
    const cp = this.getCheckpoint(taskId);
    if (!cp) return null;

    const currentStep = cp.steps[completedStepIndex];
    if (currentStep) {
      currentStep.status = 'completed';
      currentStep.completedAt = Date.now();
      currentStep.output = output;
    }

    cp.currentStepIndex = completedStepIndex + 1;
    if (cp.currentStepIndex >= cp.steps.length) {
      cp.status = 'COMPLETED';
    }

    this.saveCheckpoint(cp);
    return cp;
  }

  /**
   * Record failure and mark step as failed.
   */
  static recordStepFailure(taskId: string, stepIndex: number, error: string): TaskCheckpoint | null {
    const cp = this.getCheckpoint(taskId);
    if (!cp) return null;

    const currentStep = cp.steps[stepIndex];
    if (currentStep) {
      currentStep.status = 'failed';
      currentStep.error = error;
      currentStep.retries++;
    }

    cp.telemetry.errorCount++;
    this.saveCheckpoint(cp);
    return cp;
  }

  /**
   * Append newly generated artifact.
   */
  static attachArtifact(taskId: string, artifact: TaskArtifact): void {
    const cp = this.getCheckpoint(taskId);
    if (!cp) return;

    cp.artifacts.push(artifact);
    this.saveCheckpoint(cp);
  }

  /**
   * Clear completed or cancelled checkpoint.
   */
  static removeCheckpoint(taskId: string): void {
    this.inMemoryStore.delete(taskId);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(`${STORAGE_KEY_PREFIX}${taskId}`);
      } catch { /* ignore */ }
    }
  }
}
