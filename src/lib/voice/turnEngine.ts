// SmartTurn: Dynamic Multi-Signal End-of-Turn Engine.
// Preserves linguistic + acoustic + stability scoring while establishing
// an utterance-adaptive dynamic endpoint score.
//
// END_OF_TURN_SCORE = silence + linguistic_completion + acoustic_completion
//                   + speech_stability + confidence + pause_duration
//                   - continuation_probability

export type TurnHypothesis = 'incomplete' | 'maybe' | 'complete';

export interface TurnReading {
  hypothesis: TurnHypothesis;
  score: number;
  reasons: string[];
  adaptiveSilenceMs: number;
  continuationProbability: number;
  linguisticScore: number;
  acousticScore: number;
  stabilityScore: number;
}

const FILLERS = new Set([
  // English hesitation markers
  'and', 'so', 'uh', 'um', 'hmm', 'like', 'you', 'know', 'well', 'actually', 'basically',
  // Hindi / Hinglish hesitation markers
  'aur', 'toh', 'matlab', 'acha', 'achha', 'woh', 'yeh', 'ki', 'ke',
  'lekin', 'par', 'phir', 'bas', 'theek', 'haan', 'han', 'ruk', 'ruko',
  'ek', 'second', 'arre', 'are', 'suno', 'sun', 'bhai', 'yaar', 'bolo',
]);

const CONTINUATION_WORDS = new Set([
  // Conjunctions & prepositions indicating more words to follow
  'because', 'and', 'or', 'but', 'if', 'while', 'although', 'since', 'as',
  'that', 'which', 'who', 'whose', 'where', 'when',
  'to', 'for', 'in', 'on', 'at', 'with', 'about', 'between', 'into', 'onto', 'from',
  // Auxiliary verbs at tail (e.g., "The problem is...", "We should...")
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  // Hindi continuers
  'kyunki', 'agar', 'jab', 'tab', 'jo', 'jisme', 'jisko',
  'se', 'mein', 'pe', 'par', 'ko', 'ka', 'ke', 'ki',
]);

const UNFINISHED_PHRASE_PATTERNS = [
  /^(i\s+think|i\s+believe|i\s+guess|in\s+my\s+opinion)[.?!,…\s]*$/i,
  /^(so\s+basically|basically|the\s+thing\s+is|the\s+problem\s+is)[.?!,…\s]*$/i,
  /^(can\s+you\s+find|tell\s+me\s+about|look\s+up|search\s+for)[.?!,…\s]*$/i,
  /^(wait|hold\s+on|one\s+sec|ek\s+second|ruko)[.?!,…\s]*$/i,
  /^(ek\s+baat\s+batao|mujhe\s+lagta\s+hai|matlab\s+ki)[.?!,…\s]*$/i,
  /^(i\s+was\s+thinking|about\s+the|and\s+maybe|what\s+if|lekin|aur|yaani)[.?!,…\s]*$/i,
];

const ELLIPSIS_PUNCTUATION = /(?:\.{2,}|…)\s*$/;
const CONTINUING_PUNCTUATION = /[,;:—–\-–]\s*$/;
const TERMINAL_PUNCTUATION = /(?<!\.)[.!?।。؟]["'”’)]?\s*$/;
const QUESTION_PUNCTUATION = /\?["'”’)]?\s*$/;

export interface SyntaxAnalysis {
  linguisticScore: number;
  continuationProbability: number;
  adaptiveSilenceFloorMs: number;
  why: string;
}

export function analyzeSyntax(text: string): SyntaxAnalysis {
  const t = text.trim();
  if (!t) {
    return { linguisticScore: 0, continuationProbability: 1, adaptiveSilenceFloorMs: 2500, why: 'empty' };
  }

  const words = t.split(/\s+/);
  const wordCount = words.length;
  const lastWordRaw = words[wordCount - 1] || '';
  const lastWordClean = lastWordRaw.toLowerCase().replace(/[?!.,;:…]+$/, '');

  // 1. Check for known unfinished lead-in phrases
  for (const pattern of UNFINISHED_PHRASE_PATTERNS) {
    if (pattern.test(t)) {
      return {
        linguisticScore: 0.1,
        continuationProbability: 0.9,
        adaptiveSilenceFloorMs: 2000,
        why: `unfinished lead-in phrase "${t}"`,
      };
    }
  }

  // 2. Trailing ellipsis hesitation (e.g. "..." or "…")
  if (ELLIPSIS_PUNCTUATION.test(t)) {
    return {
      linguisticScore: 0.15,
      continuationProbability: 0.85,
      adaptiveSilenceFloorMs: 1900,
      why: 'trailing ellipsis hesitation',
    };
  }

  // 3. Trailing hesitation / filler
  if (FILLERS.has(lastWordClean)) {
    return {
      linguisticScore: 0.12,
      continuationProbability: 0.85,
      adaptiveSilenceFloorMs: 1800,
      why: `trailing filler "${lastWordClean}"`,
    };
  }

  // 3. Trailing continuation word (preposition, conjunction, auxiliary verb)
  if (CONTINUATION_WORDS.has(lastWordClean)) {
    return {
      linguisticScore: 0.2,
      continuationProbability: 0.8,
      adaptiveSilenceFloorMs: 1700,
      why: `trailing continuation word "${lastWordClean}"`,
    };
  }

  // 4. Mid-clause continuing punctuation (comma, semicolon, dash)
  if (CONTINUING_PUNCTUATION.test(t)) {
    return {
      linguisticScore: 0.35,
      continuationProbability: 0.65,
      adaptiveSilenceFloorMs: 1300,
      why: 'mid-clause punctuation',
    };
  }

  // 5. Explicit question mark or question structure
  if (QUESTION_PUNCTUATION.test(t)) {
    return {
      linguisticScore: 0.95,
      continuationProbability: 0.05,
      adaptiveSilenceFloorMs: 450,
      why: 'terminal question mark',
    };
  }

  // 6. Question starters with reasonable length (e.g. "What is...", "Can you...")
  if (/^(what|how|why|when|where|who|can\s+you|could\s+you|will\s+you|kya|kaise|kyun|kab|kahan)\b/i.test(t) && wordCount >= 4) {
    return {
      linguisticScore: 0.88,
      continuationProbability: 0.12,
      adaptiveSilenceFloorMs: 500,
      why: 'syntactic question clause',
    };
  }

  // 7. Terminal punctuation (. or ! or Devanagari danda)
  if (TERMINAL_PUNCTUATION.test(t) && wordCount >= 2) {
    return {
      linguisticScore: 0.95,
      continuationProbability: 0.05,
      adaptiveSilenceFloorMs: 450,
      why: 'terminal punctuation',
    };
  }

  // 8. Single word queries: "Yes", "No", "Stop", "Continue", "Cancel", "Haan", "Nahi"
  if (wordCount === 1) {
    if (/^(yes|no|stop|okay|ok|sure|cancel|restart|haan|han|nahi|sahi|theek)$/i.test(lastWordClean)) {
      return {
        linguisticScore: 0.9,
        continuationProbability: 0.1,
        adaptiveSilenceFloorMs: 500,
        why: 'single-word conversational response',
      };
    }
    return {
      linguisticScore: 0.25,
      continuationProbability: 0.6,
      adaptiveSilenceFloorMs: 1200,
      why: 'single word statement (waiting)',
    };
  }

  // 9. Multi-word complete statement without terminal punctuation
  // Check if it ends in a noun / noun phrase rather than open verb
  if (wordCount >= 4) {
    return {
      linguisticScore: 0.72,
      continuationProbability: 0.28,
      adaptiveSilenceFloorMs: 650,
      why: 'substantive multi-word clause',
    };
  }

  return {
    linguisticScore: 0.5,
    continuationProbability: 0.5,
    adaptiveSilenceFloorMs: 900,
    why: 'short phrase without terminal mark',
  };
}

export function turnScore(opts: {
  text: string;
  silenceMs: number; // ms since last speech energy
  stableMs: number; // ms interim text unchanged
  maxSilenceMs?: number;
  maxStableMs?: number;
  confidence?: number;
  acoustic?: { snrDb?: number; speechProb?: number; prosodyPitchDrop?: boolean };
}): TurnReading {
  const {
    text,
    silenceMs,
    stableMs,
    confidence = 0.85,
    acoustic,
  } = opts;

  const t = text.trim();
  const reasons: string[] = [];

  if (!t) {
    return {
      hypothesis: 'incomplete',
      score: 0,
      reasons: ['empty utterance'],
      adaptiveSilenceMs: 2500,
      continuationProbability: 1,
      linguisticScore: 0,
      acousticScore: 0,
      stabilityScore: 0,
    };
  }

  const syn = analyzeSyntax(t);
  const adaptiveSilence = syn.adaptiveSilenceFloorMs;

  // Normalized progress toward adaptive silence threshold
  const silenceRatio = Math.min(1, silenceMs / adaptiveSilence);
  // Stability: text being unchanged for >400ms boosts certainty
  const stabilityRatio = Math.min(1, stableMs / 1800);

  // Acoustic score: high SNR & clear speech probability
  let acousticScore = 0.7;
  if (acoustic) {
    if (acoustic.speechProb !== undefined) {
      acousticScore = Math.max(0.2, Math.min(1, acoustic.speechProb));
    }
    if (acoustic.snrDb !== undefined && acoustic.snrDb < 6) {
      acousticScore -= 0.15;
      reasons.push('low snr');
    }
    if (acoustic.prosodyPitchDrop) {
      acousticScore += 0.15;
      reasons.push('prosodic pitch fall');
    }
  }

  // Dynamic End of Turn Score Calculation:
  // Weighted blend that balances silence, linguistic structure, stability, and acoustics
  const silenceWeight = 0.35;
  const linguisticWeight = 0.35;
  const stabilityWeight = 0.18;
  const acousticWeight = 0.12;

  let score =
    silenceRatio * silenceWeight +
    syn.linguisticScore * linguisticWeight +
    stabilityRatio * stabilityWeight +
    acousticScore * acousticWeight;

  // Penalize continuation probability
  score -= syn.continuationProbability * 0.15;

  // Bonus: If stable multi-word speech exceeds adaptive silence floor, seal the turn
  if (silenceMs >= adaptiveSilence && stabilityRatio >= 0.5 && syn.linguisticScore >= 0.5) {
    score = Math.max(score, 0.82);
    reasons.push(`cleared adaptive silence (${adaptiveSilence}ms)`);
  }

  // Extreme continuation guard: if trailing word is an unfinished conjunction/preposition,
  // cap score so premature turn completion never fires on short pauses.
  if (syn.continuationProbability >= 0.8 && silenceMs < adaptiveSilence * 0.85) {
    score = Math.min(score, 0.42);
    reasons.push('continuation guard active');
  }

  reasons.push(
    `silence ${Math.round(silenceRatio * 100)}% (${silenceMs}/${adaptiveSilence}ms)`,
    `syntax: ${syn.why}`,
    `stable ${Math.round(stabilityRatio * 100)}%`
  );

  const finalScore = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const hypothesis: TurnHypothesis =
    finalScore >= 0.75 ? 'complete' : finalScore >= 0.45 ? 'maybe' : 'incomplete';

  return {
    hypothesis,
    score: finalScore,
    reasons,
    adaptiveSilenceMs: adaptiveSilence,
    continuationProbability: syn.continuationProbability,
    linguisticScore: syn.linguisticScore,
    acousticScore,
    stabilityScore: stabilityRatio,
  };
}

/** Overlap check for preemptive commit: does the final confirm the guess? */
export function confirmOverlap(guess: string, final: string): number {
  const gw = guess.toLowerCase().split(/\s+/).filter(Boolean);
  const fw = new Set(final.toLowerCase().split(/\s+/).filter(Boolean));
  if (!gw.length || !fw.size) return 0;
  let hit = 0;
  for (const w of gw) if (fw.has(w)) hit += 1;
  return hit / gw.length;
}
