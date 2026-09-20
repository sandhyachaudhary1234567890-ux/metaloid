// Unified Human Behavior Pipeline (§33)
// Architecture:
// User input -> ContextTracker -> Intent -> Response Planner -> Human Behavior Engine -> Chat / Voice

import { ContextTracker } from './contextTracker';
import { ToneEngine } from './toneEngine';
import { SocialTimingEngine } from './socialTiming';
import type { FormattedBehavioralResponse } from './types';

export class HumanBehaviorPipeline {
  /**
   * Run the behavioral pipeline on a turn before delivering to Chat or Voice.
   */
  static processTurn(
    userInput: string,
    rawModelOutput: string,
    opts: { isVoiceTurn?: boolean } = {}
  ): FormattedBehavioralResponse {
    // 1. Ingest input into real-time context tracker
    const contextState = ContextTracker.ingestUserTurn(userInput);

    // 2. Evaluate if conversational repair or clarification is required
    const repair = ToneEngine.evaluateRepair(userInput, contextState);

    // 3. Determine behavioral tuning (tone, verbosity, pacing)
    const tuning = ToneEngine.determineTuning(userInput, contextState, opts.isVoiceTurn);

    // 4. If clarification is needed, return immediate focused question
    if (repair.needed && repair.clarificationQuestion) {
      return {
        displayText: repair.clarificationQuestion,
        spokenText: repair.clarificationQuestion,
        detectedLang: SocialTimingEngine.detectLanguage(repair.clarificationQuestion),
        tuning,
        repair,
      };
    }

    // 5. Progressive disclosure & spoken formatting
    const formatted = SocialTimingEngine.formatResponse(rawModelOutput, tuning, repair.prefix);
    formatted.repair = repair;

    return formatted;
  }
}
