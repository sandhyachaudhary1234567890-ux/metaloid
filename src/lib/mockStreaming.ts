// Fake streaming engine: progressively reveals words with natural jitter.

export function streamText(
  full: string,
  onToken: (partial: string) => void,
  opts?: { wpm?: number; signal?: AbortSignal }
): Promise<string> {
  const wpm = opts?.wpm ?? 260;
  const words = full.split(/(\s+)/);
  return new Promise((resolve, reject) => {
    let i = 0;
    let out = '';
    let stopped = false;
    const signal = opts?.signal;
    const onAbort = () => {
      stopped = true;
      resolve(out);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const base = 60000 / wpm; // ms per word
    const tick = () => {
      if (stopped) return;
      if (signal?.aborted) return;
      if (i >= words.length) {
        signal?.removeEventListener('abort', onAbort);
        resolve(out);
        return;
      }
      out += words[i];
      i += 1;
      onToken(out);
      // natural jitter: punctuation pauses longer
      const last = words[i - 1] ?? '';
      let delay = base * (0.55 + Math.random() * 0.9);
      if (/[.!?…]$/.test(last.trim())) delay += 220 + Math.random() * 260;
      else if (/[,;:—]$/.test(last.trim())) delay += 90 + Math.random() * 120;
      else if (/```/.test(last)) delay += 160;
      window.setTimeout(tick, Math.max(14, delay));
    };
    tick();
  });
}

export function detectLanguageHint(text: string): string {
  const t = text.toLowerCase();
  const devanagari = /[\u0900-\u097F]/.test(text);
  if (devanagari) return 'Hindi';
  if (/\b(bhai|mujhe|kya|hai|nahi|nahin|samjha|samjhao|kaise|accha|achha|thik)\b/.test(t)) return 'Hinglish';
  if (/[ñ¿¡áéíóú]/.test(t)) return 'Spanish';
  if (/[àâçéèêëîïôûù]/i.test(text) && /\b(le|la|les|bonjour|merci)\b/i.test(text)) return 'French';
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u4e00-\u9fff]/.test(text)) return 'Chinese';
  if (/[\u0600-\u06ff]/.test(text)) return 'Arabic';
  return 'English';
}
