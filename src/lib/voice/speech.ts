// Speech director (§11–12, §28): plain response text → speakable plans.
// Never reads markdown literally; converts structure to sentences.
// Micro-pauses from punctuation; provider capability map decides what
// actually reaches the voice (no SSML assumed).

import type { SpeechPlan, TtsCapabilities } from './types';

export const TTS_CAPS: TtsCapabilities = {
  streaming: false, // chunked fallback — stated honestly, never as streaming
  chunked: true,
  wordTimestamps: true, // boundary events where the engine supports them
  ssml: false,
  multilingual: true, // per OS-installed voices
  cancellation: true,
  pauseResume: true,
};

/** Markdown/structural text → natural speech text. */
export function sanitizeForSpeech(raw: string): string {
  let s = raw;
  s = s.replace(/```[\s\S]*?```/g, ' (code omitted) ');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^>\s?/gm, '');
  s = s.replace(/^\s*[-*•]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  s = s.replace(/[*_~]/g, '');
  s = s.replace(/\n{2,}/g, '. ');
  s = s.replace(/\n/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  // lists read as sentences: "a, b, and c" already flows; nothing to do.
  return s;
}

/** Split a speakable segment into paused plans (one per sentence-ish unit). */
export function planSpeech(segment: string, rate = 1): SpeechPlan[] {
  const clean = sanitizeForSpeech(segment);
  if (!clean) return [];
  // split keeping delimiters; merge fragments under ~12 chars forward
  // (sentence set covers ASCII + Devanagari danda + CJK + Arabic)
  const parts = clean.match(/[^.!?…।。؟]+[.!?…।。؟]+["'”’)]?|\S[^.!?…।。؟]*$/g) || [clean];
  const merged: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const last = merged[merged.length - 1];
    if (last && last.length < 14) merged[merged.length - 1] = `${last} ${t}`;
    else merged.push(t);
  }
  return merged.map((text) => {
    const lastCh = text.slice(-1);
    const q = lastCh === '?';
    const exc = lastCh === '!';
    return {
      text,
      pauseBeforeMs: /[,;:]$/.test(text) ? 90 : 0,
      pauseAfterMs: q ? 200 : exc ? 170 : /[.!?…।。؟]["'”’)]?$/.test(text) ? 220 : /^[—–-]/.test(text) ? 140 : 90,
      rate,
      energy: q || exc ? 0.9 : 0.82,
      emphasis: [], // populated only when a provider supports it
    };
  });
}

/** BCP-47 tag for STT/TTS from product language id. */
export function bcp47(lang: string): string {
  switch (lang) {
    case 'hi':
    case 'hinglish':
      return 'hi-IN';
    case 'es':
      return 'es-ES';
    case 'fr':
      return 'fr-FR';
    case 'de':
      return 'de-DE';
    case 'ar':
      return 'ar-SA';
    case 'ja':
      return 'ja-JP';
    case 'ko':
      return 'ko-KR';
    case 'zh':
      return 'zh-CN';
    default:
      return 'en-US';
  }
}
