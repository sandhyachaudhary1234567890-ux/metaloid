// Dynamic Tone Adaptation & Conversational Repair Engine (§33)
// Adapts interaction style based on observable signals without claiming human emotions.
// Handles conversational repair, honest uncertainty calibration, and progressive disclosure.

import type {
  ConversationState,
  BehavioralTuning,
  RepairDirective,
} from './types';

export class ToneEngine {
  /**
   * Determine behavioral tuning for response planning.
   */
  static determineTuning(
    userText: string,
    state: ConversationState,
    isVoiceTurn = false
  ): BehavioralTuning {
    const tone = state.activeEmotionCue;
    let verbosity: BehavioralTuning['verbosity'] = isVoiceTurn ? 'concise' : 'balanced';
    let pacingMs = 0;
    let allowLightHumor = false;
    let backchannelWord: string | undefined = undefined;

    switch (tone) {
      case 'frustrated':
        verbosity = 'concise'; // Don't ramble when user is frustrated
        pacingMs = 50;
        allowLightHumor = false; // Never joke during frustration
        break;

      case 'technical':
        verbosity = isVoiceTurn ? 'concise' : 'deep';
        pacingMs = 0;
        allowLightHumor = false;
        break;

      case 'excited':
        verbosity = 'balanced';
        pacingMs = 0;
        allowLightHumor = true;
        backchannelWord = 'Nice!';
        break;

      case 'confused':
        verbosity = 'balanced';
        pacingMs = 80;
        break;

      case 'playful':
        verbosity = 'balanced';
        allowLightHumor = true;
        break;

      case 'serious':
        verbosity = 'concise';
        pacingMs = 0;
        allowLightHumor = false;
        break;

      case 'casual':
      default:
        verbosity = isVoiceTurn ? 'concise' : 'balanced';
        allowLightHumor = true;
        break;
    }

    // Check for user-preference signals ("don't explain every step, just do it")
    const lower = userText.toLowerCase();
    if (lower.includes("don't explain") || lower.includes('just do it') || lower.includes('seedha bolo')) {
      verbosity = 'concise';
    }

    return {
      tone,
      verbosity,
      pacingMs,
      progressiveDisclosure: true,
      allowLightHumor,
      backchannelWord,
    };
  }

  /**
   * Evaluate whether conversational repair is required.
   */
  static evaluateRepair(userText: string, state: ConversationState): RepairDirective {
    const lower = userText.toLowerCase();

    // 1. User is correcting a previous mistake
    if (
      lower.startsWith('no') ||
      lower.startsWith('actually') ||
      lower.startsWith('wait') ||
      lower.startsWith('galat') ||
      lower.includes("that's not what i said") ||
      lower.includes('wrong version')
    ) {
      const isHindi = /[\u0900-\u097F]/.test(userText) || lower.includes('nahi') || lower.includes('galat');
      return {
        needed: true,
        category: 'CORRECTION_ACKNOWLEDGED',
        prefix: isHindi
          ? 'Got it — main ise turant correct karta hoon.'
          : "You're right — my mistake. Let me correct that right away.",
      };
    }

    // 2. High ambiguity detected ("fix it", "run that", "kardo") with multiple active possibilities
    if (
      (lower === 'fix it' || lower === 'do it' || lower === 'kardo' || lower === 'run that') &&
      state.recentReferences.length > 1
    ) {
      return {
        needed: true,
        category: 'AMBIGUITY_CLARIFICATION',
        clarificationQuestion: `Did you mean ${state.recentReferences[0]} or ${state.recentReferences[1]}?`,
      };
    }

    // 3. Incomplete sentence fragment caught
    if (state.unfinishedThoughts.length > 0 && userText.length < 8) {
      return {
        needed: true,
        category: 'HEARING_FRAGMENT',
        prefix: 'I caught the first part — please go ahead.',
      };
    }

    return { needed: false };
  }

  /**
   * Calibrated uncertainty statement generator when assistant lacks definitive proof.
   */
  static getUncertaintyStatement(isHindi = false): string {
    return isHindi
      ? 'Main abhi is par poori tarah sure nahi hoon — let me verify this first.'
      : "I'm not completely certain yet — let me verify that directly.";
  }
}
