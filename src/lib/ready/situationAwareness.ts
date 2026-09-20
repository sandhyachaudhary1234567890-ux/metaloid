// Situation Awareness & "What is MetaIoid Doing?" Engine (§12)
// Instantly provides an accurate, plain-spoken situational brief of all active, background,
// and pending operations without technical jargon or robotic loading screens.

import { TaskCheckpointManager } from '../agent/checkpoint';

export interface SituationSummary {
  headline: string;
  speechResponse: string;
  activeTasks: string[];
  backgroundTasks: string[];
  requiresAttention: boolean;
  attentionItems: string[];
}

export class SituationAwareness {
  /**
   * Answer "What are you doing?" or "What is MetaIoid doing?" with genuine state awareness.
   */
  static getStatusBrief(): SituationSummary {
    const pendingTasks = TaskCheckpointManager.listInFlightTasks({ includePaused: true });

    const activeTasks: string[] = [];
    const backgroundTasks: string[] = [];
    const attentionItems: string[] = [];

    for (const task of pendingTasks) {
      const stepName = task.steps[task.currentStepIndex]?.label || task.objective;
      if (task.context.origin === 'chat') {
        activeTasks.push(`${task.objective} (${stepName})`);
      } else {
        backgroundTasks.push(`${task.objective}`);
      }

      const failed = task.steps.filter((s) => s.status === 'failed');
      if (failed.length > 0) {
        attentionItems.push(`Self-healing ${failed[0].label} in ${task.objective}`);
      }
    }

    let speechResponse = '';

    if (attentionItems.length > 0) {
      speechResponse = `I found a problem and I'm fixing it. ${attentionItems[0]}.`;
    } else if (activeTasks.length > 0 && backgroundTasks.length > 0) {
      speechResponse = `I'm on it — ${activeTasks[0]}, and ${backgroundTasks[0]} in the background.`;
    } else if (activeTasks.length > 0) {
      speechResponse = `I'm on it — ${activeTasks[0]}.`;
    } else if (backgroundTasks.length > 0) {
      speechResponse = `Working in the background on ${backgroundTasks[0]}.`;
    } else {
      speechResponse = 'Ready when you are.';
    }

    return {
      headline: activeTasks.length + backgroundTasks.length > 0 ? "I'm on it." : 'Ready',
      speechResponse,
      activeTasks,
      backgroundTasks,
      requiresAttention: attentionItems.length > 0,
      attentionItems,
    };
  }
}
