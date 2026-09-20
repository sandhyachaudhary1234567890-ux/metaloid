// Real-Time Social Context Tracker (§33)
// Maintains continuous context across turns so MetaIoid never asks "What were we talking about?"
// Tracks: CURRENT_TOPIC, CURRENT_GOAL, CURRENT_TASK, RECENT_REFERENCE, UNFINISHED_THOUGHT, USER_CORRECTION, ACTIVE_EMOTION_CUE.

import type { ConversationState, EmotionalToneCue } from './types';

export class ContextTracker {
  private static state: ConversationState = {
    currentTopic: 'General assistance',
    currentGoal: '',
    currentTask: '',
    recentReferences: [],
    unfinishedThoughts: [],
    userCorrections: [],
    activeEmotionCue: 'technical',
    lastTurnAt: Date.now(),
  };

  /**
   * Ingest incoming user turn and update live conversational context.
   */
  static ingestUserTurn(rawText: string): ConversationState {
    const text = rawText.trim();
    const lower = text.toLowerCase();
    const now = Date.now();

    // 1. Detect Developing / Unfinished Thoughts (fragments ending with ..., "and", "so", "because")
    const isFragment =
      text.endsWith('...') ||
      text.endsWith('..') ||
      /(?:^|\s)(and|so|because|lekin|aur|yaani)\s*$/i.test(text) ||
      /^(i was thinking|so basically|maybe we should|what if)\s*$/i.test(lower);

    if (isFragment) {
      this.state.unfinishedThoughts.push(text);
    } else if (this.state.unfinishedThoughts.length > 0) {
      // Completed thought: synthesize previous fragments with current turn
      this.state.unfinishedThoughts = [];
    }

    // 2. Detect User Corrections ("no that's not what I meant", "actually", "galat", "wait")
    const isCorrection =
      /^(no|actually|wait|not that|nah|galat|arre nahi|ruko)\b/i.test(lower) ||
      lower.includes("that's not what i meant") ||
      lower.includes('i meant');

    if (isCorrection) {
      this.state.userCorrections.push(text);
    }

    // 3. Extract Context References ("that one", "the UI", "same as before", "the previous thing")
    const referenceMatches = lower.match(/\b(that one|the previous thing|same as before|the ui|that research|yesterday's work)\b/gi);
    if (referenceMatches) {
      this.state.recentReferences = Array.from(new Set([...referenceMatches, ...this.state.recentReferences])).slice(0, 5);
    }

    // 4. Infer Emotional Tone Cue (Observable conversational signals, not clinical psychology)
    this.state.activeEmotionCue = this.detectToneCue(lower);

    // 5. Update Topic & Task
    if (lower.includes('voice') || lower.includes('audio') || lower.includes('mic')) {
      this.state.currentTopic = 'Voice Engine & Audio Pipeline';
      this.state.currentTask = 'Voice turn optimization';
    } else if (lower.includes('skill') || lower.includes('tool') || lower.includes('forge')) {
      this.state.currentTopic = 'Autonomous Skill Forge';
      this.state.currentTask = 'Skill expansion and tooling';
    } else if (lower.includes('ui') || lower.includes('theme') || lower.includes('css')) {
      this.state.currentTopic = 'UI & Design System';
      this.state.currentTask = 'Visual and interaction polish';
    } else if (lower.includes('bug') || lower.includes('error') || lower.includes('crash') || lower.includes('fail')) {
      this.state.currentTopic = 'System Debugging';
      this.state.currentTask = 'Issue resolution';
    }

    this.state.lastTurnAt = now;
    return { ...this.state };
  }

  private static detectToneCue(lower: string): EmotionalToneCue {
    if (
      lower.includes('why is it') ||
      lower.includes('still failing') ||
      lower.includes('not working') ||
      lower.includes('again') ||
      lower.includes('kya yaar') ||
      lower.includes('bakwaas')
    ) {
      return 'frustrated';
    }
    if (
      lower.includes('awesome') ||
      lower.includes('great') ||
      lower.includes('nice!') ||
      lower.includes('finally') ||
      lower.includes('badiya') ||
      lower.includes('shandar')
    ) {
      return 'excited';
    }
    if (
      lower.includes('how does') ||
      lower.includes('i don\'t get') ||
      lower.includes('confused') ||
      lower.includes('samajh nahi aaya') ||
      lower.includes('matlab?')
    ) {
      return 'confused';
    }
    if (
      lower.includes('haha') ||
      lower.includes('lol') ||
      lower.includes('joke') ||
      lower.includes('masti') ||
      lower.includes('funny')
    ) {
      return 'playful';
    }
    if (
      lower.includes('urgent') ||
      lower.includes('critical') ||
      lower.includes('production') ||
      lower.includes('security') ||
      lower.includes('important')
    ) {
      return 'serious';
    }
    if (
      lower.includes('code') ||
      lower.includes('function') ||
      lower.includes('latency') ||
      lower.includes('runtime') ||
      lower.includes('benchmark') ||
      lower.includes('sandbox')
    ) {
      return 'technical';
    }
    return 'casual';
  }

  static getState(): ConversationState {
    return { ...this.state };
  }

  static setActiveTool(toolName?: string) {
    this.state.activeTool = toolName;
  }

  static setActiveBackgroundTask(taskName?: string) {
    this.state.activeBackgroundTask = taskName;
  }

  static reset() {
    this.state = {
      currentTopic: 'General assistance',
      currentGoal: '',
      currentTask: '',
      recentReferences: [],
      unfinishedThoughts: [],
      userCorrections: [],
      activeEmotionCue: 'technical',
      lastTurnAt: Date.now(),
    };
  }
}
