// Conversation Response Planner.
// Directs voice-first LLM prompting, separates spoken voice from chat display,
// provides fast acknowledgments, and prevents repetitive phrasing.

export const VOICE_SYSTEM_INSTRUCTION = `
You are MetaIoid speaking in a real-time voice conversation.
Generate the response so it can be spoken naturally.
Do not write an essay and then convert it into speech.
Think in complete conversational thoughts.
Each thought should:
- stand on its own
- transition naturally to the next thought
- avoid unnecessary setup
- avoid repetition
- be easy to pronounce
- preserve exact factual meaning
The first 1–2 sentences must be useful immediately.
Do not begin with generic acknowledgements unless they add value.
If code or structured data is requested, provide a concise verbal summary explaining the key mechanism, and place the full implementation in standard markdown blocks for the chat interface.
`.trim();

export interface VoicePlanDirective {
  fastAcknowledgement?: string;
  isDeepResearch: boolean;
  isCodeHeavy: boolean;
  isConversationalRepair: boolean;
  expectedTone: 'direct' | 'exploratory' | 'provisional';
}

export class ConversationResponsePlanner {
  private spokenThoughtHashes = new Set<string>();

  reset() {
    this.spokenThoughtHashes.clear();
  }

  /**
   * Evaluates user utterance and decides turn directives before LLM execution.
   */
  planTurn(userUtterance: string): VoicePlanDirective {
    const clean = userUtterance.trim().toLowerCase();

    // 1. Deep research / search queries: provide instantaneous natural acknowledgment
    const isDeepResearch = /\b(research|compare|latest|find out|investigate|benchmarks|pricing)\b/i.test(clean);
    let fastAcknowledgement: string | undefined;

    if (isDeepResearch && clean.split(/\s+/).length >= 4) {
      if (clean.includes('pricing') || clean.includes('price')) {
        fastAcknowledgement = 'Yep, checking the latest pricing now.';
      } else if (clean.includes('compare')) {
        fastAcknowledgement = 'Got it. Pulling up the comparison.';
      } else {
        fastAcknowledgement = "Yep, looking into that now.";
      }
    }

    // 2. Code-heavy requests
    const isCodeHeavy = /\b(code|function|component|script|implement|build me|write a)\b/i.test(clean);

    // 3. Conversational repair / correction
    const isConversationalRepair = /^(actually|wait|no|hold on|sorry|i meant)\b/i.test(clean);

    return {
      fastAcknowledgement,
      isDeepResearch,
      isCodeHeavy,
      isConversationalRepair,
      expectedTone: isDeepResearch ? 'provisional' : isCodeHeavy ? 'direct' : 'direct',
    };
  }

  /**
   * Separates full assistant response into:
   * 1. Spoken text (clean, concise, conversational)
   * 2. Chat display text (includes complete code fences, tables, etc.)
   */
  separateVoiceAndChat(fullResponseText: string): {
    voiceText: string;
    chatText: string;
    hasCode: boolean;
    hasTable: boolean;
  } {
    const hasCode = /```[\s\S]*?```/.test(fullResponseText);
    const hasTable = /^\s*\|.*?\|\s*$/m.test(fullResponseText);

    if (!hasCode && !hasTable) {
      return {
        voiceText: fullResponseText,
        chatText: fullResponseText,
        hasCode: false,
        hasTable: false,
      };
    }

    // When code or tables are present, voice gets the natural explanation,
    // while the chat display preserves the complete markdown.
    let voiceText = fullResponseText;
    if (hasCode) {
      voiceText = voiceText.replace(/```(?:[a-z0-9_-]+)?\s*[\s\S]*?```/gi, ' I have shared the complete code in the chat. ');
    }
    if (hasTable) {
      voiceText = voiceText.replace(/^\s*\|.*?\|\s*$/gm, '');
      voiceText = voiceText.replace(/^\s*\|?[-:| ]+\|?\s*$/gm, '');
    }

    return {
      voiceText: voiceText.trim(),
      chatText: fullResponseText,
      hasCode,
      hasTable,
    };
  }

  /**
   * Repetition prevention: checks if a thought has already been spoken in this turn.
   */
  isDuplicateThought(text: string): boolean {
    const key = text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join(' ');

    if (!key || key.length < 8) return false;
    if (this.spokenThoughtHashes.has(key)) return true;
    this.spokenThoughtHashes.add(key);
    return false;
  }
}

export const defaultResponsePlanner = new ConversationResponsePlanner();
