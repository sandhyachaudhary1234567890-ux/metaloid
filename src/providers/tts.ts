// Speech Synthesis Engine — Plays real audio via Web Speech API
// with Chrome auto-resume watchdog, language matching, and rate controls.

let speakingTimer: number | null = null;
let watchdogTimer: number | null = null;
let speaking = false;
let currentUtterance: SpeechSynthesisUtterance | null = null;

export function getVoices() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const raw = window.speechSynthesis.getVoices();
    if (raw.length > 0) {
      return raw.slice(0, 10).map((v) => ({
        id: v.voiceURI,
        label: `${v.name} (${v.lang})`,
        lang: v.lang.startsWith('hi') ? 'hi' : 'en',
      }));
    }
  }
  return [
    { id: 'swara', label: 'Swara — Hindi (warm)', lang: 'hi' },
    { id: 'madhur', label: 'Madhur — Hindi (calm)', lang: 'hi' },
    { id: 'arjun', label: 'Arjun — Hindi/English', lang: 'hi' },
    { id: 'en-natural', label: 'Natural English', lang: 'en' },
    { id: 'en-custom', label: 'Custom', lang: 'en' },
  ];
}

export function speakText(text: string, opts?: { rate?: number; onEnd?: () => void; lang?: string }): Promise<void> {
  stopSpeaking();
  const clean = text.replace(/[*_`#~]/g, '').trim();
  if (!clean) return Promise.resolve();

  speaking = true;

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(clean);
        currentUtterance = u;
        u.rate = Math.max(0.8, Math.min(1.8, opts?.rate ?? 1));
        u.pitch = 1;
        u.volume = 1;

        const lang = opts?.lang || (/[\u0900-\u097F]/.test(clean) ? 'hi-IN' : 'en-US');
        u.lang = lang;

        const voices = window.speechSynthesis.getVoices();
        const match = voices.find((v) => v.lang === lang || v.lang.startsWith(lang.slice(0, 2)));
        if (match) u.voice = match;

        let finished = false;
        const cleanup = () => {
          if (finished) return;
          finished = true;
          speaking = false;
          currentUtterance = null;
          if (watchdogTimer) {
            window.clearInterval(watchdogTimer);
            watchdogTimer = null;
          }
          opts?.onEnd?.();
          resolve();
        };

        u.onend = cleanup;
        u.onerror = cleanup;

        // Chrome SpeechSynthesis auto-pause watchdog
        watchdogTimer = window.setInterval(() => {
          if (speaking && window.speechSynthesis.paused) {
            try { window.speechSynthesis.resume(); } catch { /* ignore */ }
          }
        }, 3000);

        try { window.speechSynthesis.resume(); } catch { /* ignore */ }
        window.speechSynthesis.speak(u);

        // Safety timeout in case browser never fires onend
        const words = clean.split(/\s+/).length;
        const maxMs = Math.max(4000, (words / 1.5) * 1000);
        speakingTimer = window.setTimeout(cleanup, maxMs);
      } catch {
        speaking = false;
        opts?.onEnd?.();
        resolve();
      }
    });
  }

  // Headless fallback
  const words = clean.split(/\s+/).length;
  const rate = opts?.rate ?? 1;
  const ms = Math.min(12000, Math.max(1800, (words / (2.6 * rate)) * 1000));
  return new Promise((resolve) => {
    speakingTimer = window.setTimeout(() => {
      speaking = false;
      speakingTimer = null;
      opts?.onEnd?.();
      resolve();
    }, ms);
  });
}

export function stopSpeaking() {
  speaking = false;
  currentUtterance = null;
  if (speakingTimer) {
    window.clearTimeout(speakingTimer);
    speakingTimer = null;
  }
  if (watchdogTimer) {
    window.clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch { /* noop */ }
}

export function isSpeaking() {
  return speaking;
}
