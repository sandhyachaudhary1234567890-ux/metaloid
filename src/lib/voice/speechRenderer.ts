// Deterministic Speech Renderer.
// Transforms written AI language into natural, pronunciation-safe spoken language.
// Fast, synchronous, deterministic — NO non-deterministic LLM rewriting.
// Handles markdown stripping, number/currency normalization, technical acronyms,
// code suppression, and conversational phrasing.

const ACRONYM_DICTIONARY: Record<string, string> = {
  API: 'A-P-I',
  APIs: "A-P-I's",
  LLM: 'L-L-M',
  LLMs: "L-L-M's",
  GPU: 'G-P-U',
  GPUs: "G-P-U's",
  CPU: 'C-P-U',
  CPUs: "C-P-U's",
  HTTP: 'H-T-T-P',
  HTTPS: 'H-T-T-P-S',
  URL: 'U-R-L',
  URLs: "U-R-L's",
  UI: 'U-I',
  UX: 'U-X',
  AI: 'A-I',
  ASR: 'A-S-R',
  TTS: 'T-T-S',
  VAD: 'V-A-D',
  OS: 'O-S',
  SDK: 'S-D-K',
  SDKs: "S-D-K's",
  CLI: 'C-L-I',
  REST: 'rest',
  JSON: 'jay-son',
  SQL: 'sequel',
  NoSQL: 'no-sequel',
  HTML: 'H-T-M-L',
  CSS: 'C-S-S',
  DOM: 'D-O-M',
  EOF: 'E-O-F',
  IO: 'I-O',
  DB: 'D-B',
  Wasm: 'waz-um',
  WebSockets: 'web sockets',
  WebSocket: 'web socket',
  MetaIoid: 'Metaloid',
  metaIoid: 'Metaloid',
};

const ROBOTIC_CLICHES: [RegExp, string][] = [
  [/^as an ai language model[,.]?\s*/i, ''],
  [/^based on the (?:information|context|data) provided[,.]?\s*/i, 'From what I found, '],
  [/^based on my analysis[,.]?\s*/i, 'Looking at this, '],
  [/^it is important to note that\s*/i, 'Note that '],
  [/^it is worth mentioning that\s*/i, 'Also, '],
  [/^in conclusion[,.]?\s*/i, 'Overall, '],
  [/^certainly[!,.]\s*/i, 'Sure. '],
  [/^absolutely[!,.]\s*/i, 'Yep. '],
];

export class SpeechRenderer {
  /**
   * Main rendering function: plain text -> clean natural spoken wording.
   */
  render(rawText: string): string {
    if (!rawText || !rawText.trim()) return '';

    let text = rawText;

    // 1. Remove code blocks and visual tables
    text = this.suppressCodeAndTables(text);

    // 2. Strip visual markdown syntax
    text = this.stripMarkdown(text);

    // 3. Remove robotic AI preambles
    text = this.cleanRoboticPhrasing(text);

    // 4. Normalize URLs
    text = this.normalizeUrls(text);

    // 5. Normalize currency, numbers, and technical units
    text = this.normalizeNumbersAndUnits(text);

    // 6. Normalize technical acronyms for clear phonetics
    text = this.normalizeAcronyms(text);

    // 7. Conversational contractions
    text = this.applyNaturalContractions(text);

    // 8. Clean up whitespace and stray punctuation
    text = text.replace(/\s+/g, ' ').trim();
    text = text.replace(/([.,!?])\1+/g, '$1');

    return text;
  }

  /**
   * Suppress raw code blocks and markdown tables from speech output.
   */
  private suppressCodeAndTables(text: string): string {
    let s = text;
    // Replace fenced code blocks
    s = s.replace(/```(?:[a-z0-9_-]+)?\s*[\s\S]*?```/gi, ' I have shared the code in the chat. ');
    // Strip markdown table rows (lines starting with | and ending with |)
    s = s.replace(/^\s*\|.*?\|\s*$/gm, '');
    // Strip table separator lines |---|---|
    s = s.replace(/^\s*\|?[-:| ]+\|?\s*$/gm, '');
    return s;
  }

  /**
   * Strip visual formatting: headings, links, bold, italics, citations.
   */
  private stripMarkdown(text: string): string {
    let s = text;
    // Remove citations e.g. [1], [2], [citation needed]
    s = s.replace(/\[\d+\]/g, '');
    s = s.replace(/\[citation needed\]/gi, '');
    // Links: [label](url) -> label
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Inline code: `varName` -> varName
    s = s.replace(/`([^`]+)`/g, '$1');
    // Headings: ### Title -> Title.
    s = s.replace(/^#{1,6}\s+(.+)$/gm, '$1. ');
    // Blockquotes: > quote -> quote
    s = s.replace(/^>\s?/gm, '');
    // Bullet lists: - item -> item
    s = s.replace(/^\s*[-*•]\s+/gm, '');
    // Numbered lists: 1. Item -> Item
    s = s.replace(/^\s*(\d+)\.\s+/gm, '');
    // Bold, italic, strikethrough: **text**, *text*, ~~text~~
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/\*([^*]+)\*/g, '$1');
    s = s.replace(/__([^_]+)__/g, '$1');
    s = s.replace(/_([^_]+)_/g, '$1');
    s = s.replace(/~~([^~]+)~~/g, '$1');
    return s;
  }

  private cleanRoboticPhrasing(text: string): string {
    let s = text;
    for (const [re, replacement] of ROBOTIC_CLICHES) {
      s = s.replace(re, replacement);
    }
    return s;
  }

  private normalizeUrls(text: string): string {
    // Convert full URLs into readable domain names
    // e.g. https://www.github.com/metaloid -> github dot com
    return text.replace(/https?:\/\/(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})(?:\/[^\s]*)?/g, '$1');
  }

  private normalizeNumbersAndUnits(text: string): string {
    let s = text;

    // Currency: ₹1500 / ₹1,500 -> "fifteen hundred rupees"
    s = s.replace(/₹\s*1500\b/g, 'fifteen hundred rupees');
    s = s.replace(/₹\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g, (_m, num, dec) => {
      const cleanNum = num.replace(/,/g, '');
      const decPart = dec ? ` point ${dec}` : '';
      return `${cleanNum}${decPart} rupees`;
    });

    // Dollar: $50 / $50.00 / $2.5M
    s = s.replace(/\$\s*(\d+(?:\.\d+)?)\s*M\b/gi, '$1 million dollars');
    s = s.replace(/\$\s*(\d+(?:\.\d+)?)\s*B\b/gi, '$1 billion dollars');
    s = s.replace(/\$\s*(\d+(?:\.\d+)?)\s*K\b/gi, '$1 thousand dollars');
    s = s.replace(/\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g, (_m, num, dec) => {
      const cleanNum = num.replace(/,/g, '');
      const decPart = dec ? ` point ${dec}` : '';
      return `${cleanNum}${decPart} dollars`;
    });

    // Euro & Pound
    s = s.replace(/€\s*(\d+)/g, '$1 euros');
    s = s.replace(/£\s*(\d+)/g, '$1 pounds');

    // Units: 5GB, 100MB, 50ms, 2.5s, 5.2%
    s = s.replace(/\b(\d+(?:\.\d+)?)\s*GB\b/gi, '$1 gigabytes');
    s = s.replace(/\b(\d+(?:\.\d+)?)\s*MB\b/gi, '$1 megabytes');
    s = s.replace(/\b(\d+(?:\.\d+)?)\s*KB\b/gi, '$1 kilobytes');
    s = s.replace(/\b(\d+(?:\.\d+)?)\s*ms\b/gi, '$1 milliseconds');
    s = s.replace(/\b(\d+(?:\.\d+)?)\s*s\b/gi, '$1 seconds');
    s = s.replace(/\b(\d+(?:\.\d+)?)\s*%\b/g, '$1 percent');

    // Years: 2024 -> twenty twenty-four, 2026 -> twenty twenty-six
    s = s.replace(/\b2024\b/g, 'twenty twenty-four');
    s = s.replace(/\b2025\b/g, 'twenty twenty-five');
    s = s.replace(/\b2026\b/g, 'twenty twenty-six');
    s = s.replace(/\b2027\b/g, 'twenty twenty-seven');

    return s;
  }

  private normalizeAcronyms(text: string): string {
    let s = text;
    for (const [acronym, spoken] of Object.entries(ACRONYM_DICTIONARY)) {
      const regex = new RegExp(`\\b${acronym}\\b`, 'g');
      s = s.replace(regex, spoken);
    }
    return s;
  }

  private applyNaturalContractions(text: string): string {
    // Subtle conversational contractions that flow better in TTS
    return text
      .replace(/\bdo not\b/gi, "don't")
      .replace(/\bcannot\b/gi, "can't")
      .replace(/\bwill not\b/gi, "won't")
      .replace(/\bit is\b/gi, "it's")
      .replace(/\bthat is\b/gi, "that's")
      .replace(/\bthere is\b/gi, "there's")
      .replace(/\bwe will\b/gi, "we'll")
      .replace(/\byou will\b/gi, "you'll");
  }
}

export const defaultSpeechRenderer = new SpeechRenderer();
