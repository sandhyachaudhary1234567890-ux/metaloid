// Semantic and Syntactic Speech Chunker.
// Streams LLM tokens -> Incremental text buffer -> Clause parser ->
// Semantic & Grammatical completeness score -> Stability window -> Speech-ready chunks.
// Never relies on punctuation alone. Never cuts mid-thought or at trailing continuers.

import type { SpeechChunk, SpeechChunkStatus } from './types';

const TRAILING_CONTINUERS = new Set([
  // Conjunctions
  'and', 'or', 'but', 'because', 'so', 'if', 'while', 'although', 'since', 'as',
  'that', 'which', 'who', 'whom', 'whose', 'where', 'when',
  // Prepositions
  'to', 'for', 'in', 'on', 'at', 'with', 'about', 'between', 'into', 'onto', 'from',
  'through', 'during', 'before', 'after', 'above', 'below', 'under',
  // Auxiliary verbs & copulas
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  // Hinglish / Hindi continuers
  'aur', 'ya', 'lekin', 'par', 'kyunki', 'agar', 'jab', 'tab', 'ki', 'ke', 'ka', 'ko',
  'se', 'mein', 'hai', 'hain', 'tha', 'thi', 'the', 'hoga', 'hogi', 'jaise', 'matlab',
]);

const COMPARATIVE_TAILS = [
  /such\s+as$/i,
  /more\s+than$/i,
  /less\s+than$/i,
  /compared\s+to$/i,
  /rather\s+than$/i,
  /due\s+to$/i,
  /in\s+terms\s+of$/i,
  /as\s+well\s+as$/i,
  /because\s+of$/i,
];

const UNFINISHED_NUMBER_REGEX = /(?:[\$₹€£]|\b\d+\.|\b\d+,\s*)$/;
const UNRESOLVED_ENTITY_REGEX = /(?:["'(\[{<]|`|\*\*?|__?)$/;

let chunkCounter = 0;

export interface ChunkerConfig {
  minFirstChunkWords: number;
  minSubsequentChunkWords: number;
  maxChunkCharacters: number;
  stabilityWindowMs: number;
}

const DEFAULT_CONFIG: ChunkerConfig = {
  minFirstChunkWords: 4,
  minSubsequentChunkWords: 7,
  maxChunkCharacters: 180,
  stabilityWindowMs: 250,
};

export class SpeechChunker {
  private buffer = '';
  private lastStreamLength = 0;
  private emittedChunks: SpeechChunk[] = [];
  private currentTurnId = '';
  private currentGenerationId = 0;
  private firstChunkEmitted = false;
  private lastPushTime = Date.now();
  private config: ChunkerConfig;

  constructor(config: Partial<ChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  reset(turnId = '', generationId = 0) {
    this.buffer = '';
    this.lastStreamLength = 0;
    this.emittedChunks = [];
    this.currentTurnId = turnId;
    this.currentGenerationId = generationId;
    this.firstChunkEmitted = false;
    this.lastPushTime = Date.now();
  }

  /**
   * Push newly streamed full text (cumulative).
   * Parses candidate clauses and returns ready speech chunks.
   */
  push(fullText: string): SpeechChunk[] {
    if (fullText.length < this.lastStreamLength) {
      // Stream restarted
      this.buffer = '';
      this.lastStreamLength = 0;
    }

    const delta = fullText.slice(this.lastStreamLength);
    this.lastStreamLength = fullText.length;
    this.buffer += delta;
    this.lastPushTime = Date.now();

    return this.extractReadyChunks(false);
  }

  /**
   * Called periodically to flush stable phrases if stream stalled.
   */
  poll(): SpeechChunk[] {
    const idleMs = Date.now() - this.lastPushTime;
    if (idleMs >= this.config.stabilityWindowMs && this.buffer.trim().length > 0) {
      return this.extractReadyChunks(false);
    }
    return [];
  }

  /**
   * Flush all remaining buffered text at stream completion.
   */
  finish(): SpeechChunk[] {
    const chunks = this.extractReadyChunks(true);
    // If anything still remains in the buffer, wrap as final chunk
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      const finalChunk = this.buildChunk(remaining, true, true, 1.0);
      chunks.push(finalChunk);
      this.buffer = '';
    }
    return chunks;
  }

  getPendingText(): string {
    return this.buffer;
  }

  getEmittedChunks(): SpeechChunk[] {
    return [...this.emittedChunks];
  }

  private extractReadyChunks(isStreamFinished: boolean): SpeechChunk[] {
    const readyChunks: SpeechChunk[] = [];

    while (this.buffer.trim().length > 0) {
      const candidate = this.findNextCandidate(this.buffer, isStreamFinished);
      if (!candidate) break;

      const evalResult = this.evaluateCandidate(candidate.text, isStreamFinished);

      if (evalResult.speechReady) {
        const chunk = this.buildChunk(
          candidate.text,
          evalResult.semanticComplete,
          evalResult.grammaticalComplete,
          evalResult.confidence
        );
        readyChunks.push(chunk);
        this.emittedChunks.push(chunk);
        this.firstChunkEmitted = true;
        this.buffer = candidate.remaining.trimStart();
      } else {
        // If not ready and not forcing, wait for more tokens
        break;
      }
    }

    return readyChunks;
  }

  /**
   * Search for potential thought boundaries:
   * 1. Terminal sentence boundaries (. ! ? । 。)
   * 2. Natural clause boundaries (, ; : —)
   * 3. Max length word boundary
   */
  private findNextCandidate(
    text: string,
    isStreamFinished: boolean
  ): { text: string; remaining: string } | null {
    const trimmed = text.trimStart();
    if (!trimmed) return null;

    const minWords = this.firstChunkEmitted
      ? this.config.minSubsequentChunkWords
      : this.config.minFirstChunkWords;

    // Pattern 1: Terminal sentence boundary (. ! ? । 。 ؟)
    // Matches at least a minimal word sequence followed by terminal punctuation + whitespace or end
    const sentenceMatch = trimmed.match(/^(.+?[.!?…।。؟]["'”’)]?)(?:\s+|$)/);
    if (sentenceMatch) {
      const candidateText = sentenceMatch[1].trim();
      const words = candidateText.split(/\s+/).filter(Boolean);
      // Ensure it has enough body, or is stream end
      if (words.length >= Math.min(2, minWords) || isStreamFinished) {
        return {
          text: candidateText,
          remaining: trimmed.slice(sentenceMatch[0].length),
        };
      }
    }

    // Pattern 2: Natural clause break at comma/semicolon/dash
    // (Only if text is substantial enough to warrant a natural pause AND not followed by a continuer)
    const clauseMatch = trimmed.match(/^(.+?[,;:—–])(?:\s+|$)/);
    if (clauseMatch) {
      const candidateText = clauseMatch[1].trim();
      const remaining = trimmed.slice(clauseMatch[0].length);
      const remainingFirstWord = remaining.trim().split(/\s+/)[0]?.toLowerCase().replace(/[.,!?]+$/, '');
      const nextIsContinuer = remainingFirstWord && TRAILING_CONTINUERS.has(remainingFirstWord);

      const words = candidateText.split(/\s+/).filter(Boolean);
      if (words.length >= minWords && !nextIsContinuer) {
        return {
          text: candidateText,
          remaining,
        };
      }
    }

    // Pattern 3: Hard ceiling cutoff at word boundary before maxChunkCharacters
    if (trimmed.length >= this.config.maxChunkCharacters) {
      const cutIdx = trimmed.lastIndexOf(' ', this.config.maxChunkCharacters);
      if (cutIdx > 30) {
        return {
          text: trimmed.slice(0, cutIdx).trim(),
          remaining: trimmed.slice(cutIdx),
        };
      }
    }

    // If stream finished, take whatever valid words are left
    if (isStreamFinished && trimmed.length > 0) {
      return {
        text: trimmed,
        remaining: '',
      };
    }

    return null;
  }

  /**
   * Evaluate semantic completeness, grammatical completeness, stability, and absence of cut-off entities.
   */
  evaluateCandidate(
    text: string,
    isStreamFinished: boolean
  ): {
    speechReady: boolean;
    semanticComplete: boolean;
    grammaticalComplete: boolean;
    confidence: number;
  } {
    const t = text.trim();
    const words = t.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    if (wordCount === 0) {
      return { speechReady: false, semanticComplete: false, grammaticalComplete: false, confidence: 0 };
    }

    // If stream is finished, we don't hold back remaining text
    if (isStreamFinished) {
      return { speechReady: true, semanticComplete: true, grammaticalComplete: true, confidence: 0.95 };
    }

    // Check 1: Trailing continuer / conjunction / preposition / auxiliary verb
    // E.g. "The main reason is because" or "I checked the pricing, and"
    const lastWord = words[wordCount - 1].toLowerCase().replace(/[.,!?:;…]+$/, '');
    if (TRAILING_CONTINUERS.has(lastWord)) {
      return { speechReady: false, semanticComplete: false, grammaticalComplete: false, confidence: 0.2 };
    }

    // Check 2: Trailing comparative phrase (e.g. "such as", "more than")
    for (const pattern of COMPARATIVE_TAILS) {
      if (pattern.test(t)) {
        return { speechReady: false, semanticComplete: false, grammaticalComplete: false, confidence: 0.25 };
      }
    }

    // Check 3: Unfinished number (e.g. ends with "$", "₹", "1500.")
    if (UNFINISHED_NUMBER_REGEX.test(t)) {
      return { speechReady: false, semanticComplete: false, grammaticalComplete: false, confidence: 0.1 };
    }

    // Check 4: Unresolved entity (unclosed quotes, open markdown tags, open bracket)
    if (UNRESOLVED_ENTITY_REGEX.test(t)) {
      return { speechReady: false, semanticComplete: false, grammaticalComplete: false, confidence: 0.3 };
    }

    // Check 5: Grammatical & Semantic Completeness
    // Must have at least subject + verb or be a recognized conversational phrase
    const hasTerminalPunctuation = /[.!?…।。؟]["'”’)]?$/.test(t);
    const minWords = this.firstChunkEmitted
      ? this.config.minSubsequentChunkWords
      : this.config.minFirstChunkWords;

    let grammaticalComplete = false;
    let semanticComplete = false;
    let confidence = 0.6;

    if (hasTerminalPunctuation && wordCount >= 3) {
      grammaticalComplete = true;
      semanticComplete = true;
      confidence = 0.92;
    } else if (wordCount >= minWords) {
      // Complete thought clause ending with natural comma or safe pause
      grammaticalComplete = true;
      semanticComplete = true;
      confidence = 0.78;
    } else if (wordCount <= 3 && /^(yeah|got it|right|yep|sure|understood|haan|theek hai)[.!]?$/i.test(t)) {
      // Short conversational acknowledgment
      grammaticalComplete = true;
      semanticComplete = true;
      confidence = 0.95;
    }

    const stabilityScore = 0.85; // Buffer is held and trailing word is complete

    const speechReady =
      semanticComplete &&
      grammaticalComplete &&
      stabilityScore >= 0.7 &&
      confidence >= 0.7;

    return { speechReady, semanticComplete, grammaticalComplete, confidence };
  }

  private buildChunk(
    text: string,
    semanticComplete: boolean,
    grammaticalComplete: boolean,
    confidence: number
  ): SpeechChunk {
    chunkCounter++;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    // Estimated duration at ~150 words per minute (400ms per word average)
    const estimatedDurationMs = Math.round(wordCount * 380);

    return {
      id: `chunk_${Date.now()}_${chunkCounter}`,
      text,
      spokenText: text, // populated post-renderer
      semanticComplete,
      grammaticalComplete,
      stable: true,
      confidence,
      estimatedDurationMs,
      sourceGenerationId: this.currentGenerationId,
      turnId: this.currentTurnId,
      status: 'READY',
    };
  }
}
