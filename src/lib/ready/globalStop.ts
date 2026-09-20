// Global "Stop Everything" Controller (§11)
// One-click emergency halt available from Command Palette, Live Status, and HUD.
// Instantly terminates active speech, pauses/cancels background tasks, and cancels
// pending tool requests while strictly PRESERVING all completed work and checkpoints.

import { TaskCheckpointManager } from '../agent/checkpoint';
import { InitiativeEngine } from '../agent/initiativeEngine';
import { EventTrail } from '../agent/eventTrail';

export interface GlobalHaltResult {
  speechStopped: boolean;
  tasksPaused: number;
  toolsCancelled: number;
  preservedArtifactsCount: number;
  timestamp: number;
  message: string;
}

export class GlobalStopController {
  private static toolAbortControllers: Set<AbortController> = new Set();
  private static halted = false;

  static isHalted(): boolean {
    return this.halted;
  }

  static clearHalt(): void {
    this.halted = false;
    InitiativeEngine.clearInterrupt();
  }

  /**
   * Register a cancellable tool operation.
   */
  static registerToolAbort(controller: AbortController): () => void {
    this.toolAbortControllers.add(controller);
    return () => {
      this.toolAbortControllers.delete(controller);
    };
  }

  /**
   * Universal Emergency Halt:
   * 1. Stop current speech & audio context
   * 2. Pause in-flight background tasks
   * 3. Abort pending tool executions
   * 4. Keep all finished steps and produced artifacts intact
   */
  static stopAll(): GlobalHaltResult {
    let speechStopped = false;

    // 1. Terminate browser speech synthesis / audio playback
    if (typeof window !== 'undefined') {
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        speechStopped = true;
      }
      // Broadcast stop event for VoiceMode and WebAudio contexts
      window.dispatchEvent(new CustomEvent('metaloid:emergency_stop'));
      speechStopped = true;
    }

    // 2. Cancel in-flight tool HTTP requests or processes
    let toolsCancelled = 0;
    for (const controller of this.toolAbortControllers) {
      try {
        controller.abort('Emergency global stop triggered by user');
        toolsCancelled++;
      } catch { /* ignore */ }
    }
    this.toolAbortControllers.clear();

    this.halted = true;
    const initiativesCancelled = InitiativeEngine.interruptAll();

    // 3. Pause in-flight background checkpoints safely without wiping artifacts
    let tasksPaused = 0;
    let preservedArtifactsCount = 0;
    const pendingTasks = TaskCheckpointManager.listInFlightTasks();

    for (const task of pendingTasks) {
      task.status = 'PAUSED';
      preservedArtifactsCount += task.artifacts.length;
      TaskCheckpointManager.saveCheckpoint(task);
      tasksPaused++;
    }

    EventTrail.record('interrupt', 'global_stop', {
      tasksPaused,
      toolsCancelled,
      initiativesCancelled,
    });

    return {
      speechStopped,
      tasksPaused,
      toolsCancelled,
      preservedArtifactsCount,
      timestamp: Date.now(),
      message: 'Stopped. Completed work is saved.',
    };
  }
}
