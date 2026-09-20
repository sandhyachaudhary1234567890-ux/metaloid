// Social Timing, Progressive Disclosure & Multilingual Renderer (§33)
// 1. Progressive Disclosure: Answers immediate question first, then expands details.
// 2. Multilingual: Natural English, Hindi, and Hinglish detection without robotic translations.
// 3. Spoken Text Normalization: Cleans markdown, URLs, and code blocks for fluid TTS delivery.

import type { BehavioralTuning, FormattedBehavioralResponse } from './types';

export class SocialTimingEngine {
  /**
   * Detect dynamic language hint (English, Hindi, Hinglish).
   */
  static detectLanguage(text: string): 'English' | 'Hindi' | 'Hinglish' {
    const raw = text.trim();
    if (/[\u0900-\u097F]/.test(raw)) return 'Hindi';

    const lower = raw.toLowerCase();
    const hinglishWords = [
      'kya', 'hai', 'nahi', 'karo', 'kaise', 'batao', 'thik', 'accha',
      'bolo', 'suno', 'yaar', 'mera', 'tera', 'hum', 'aap', 'matlab',
      'badiya', 'ruko', 'lekin', 'aur', 'samajh', 'kaam'
    ];

    const words = lower.split(/\s+/);
    const hinglishCount = words.filter((w) => hinglishWords.includes(w)).length;

    if (hinglishCount >= 2 || (words.length <= 4 && hinglishCount >= 1)) {
      return 'Hinglish';
    }

    return 'English';
  }

  /**
   * Structure response using progressive disclosure.
   */
  static formatResponse(
    rawAnswer: string,
    tuning: BehavioralTuning,
    prefix?: string
  ): FormattedBehavioralResponse {
    let body = rawAnswer.trim();

    // 1. Progressive Disclosure: In concise mode, lead with primary sentence/paragraph of the body
    if (tuning.verbosity === 'concise') {
      const firstBreak = body.indexOf('\n\n');
      if (firstBreak !== -1 && firstBreak > 15) {
        // Keep primary conclusion
        body = body.slice(0, firstBreak).trim();
      }
    }

    // 2. Apply conversational repair prefix if present
    const displayText = prefix ? `${prefix}\n\n${body}` : body;

    // 3. Clean Spoken Text for Voice Delivery
    const spokenText = this.cleanForSpeech(displayText);
    const detectedLang = this.detectLanguage(displayText);

    return {
      displayText,
      spokenText,
      detectedLang,
      tuning,
    };
  }

  /**
   * Normalize markdown text for clean, natural speech synthesis.
   */
  private static cleanForSpeech(text: string): string {
    return text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, ' I have shared the code in the chat. ')
      // Remove inline code
      .replace(/`([^`]+)`/g, '$1')
      // Remove markdown links [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove bold/italics
      .replace(/[*_#~]/g, '')
      // Remove bullet asterisks
      .replace(/^[\s*-]+/gm, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }
}
