// Future Edge TTS / voice synthesis placeholder.
// TODO(backend): route speakText() through a server endpoint that calls Edge TTS.
// UI treats these as async speech state only (no real audio in prototype, except
// optional Web Speech API when user explicitly enables voice — still local).

let speakingTimer: number | null = null;
let speaking = false;

export function getVoices() {
  return [
    { id: 'swara', label: 'Swara — Hindi (warm)', lang: 'hi' },
    { id: 'madhur', label: 'Madhur — Hindi (calm)', lang: 'hi' },
    { id: 'arjun', label: 'Arjun — Hindi/English', lang: 'hi' },
    { id: 'en-natural', label: 'Natural English', lang: 'en' },
    { id: 'en-custom', label: 'Custom', lang: 'en' },
  ];
}

export function speakText(text: string, opts?: { rate?: number; onEnd?: () => void }): Promise<void> {
  // Mock: resolve after estimated duration; caller drives SPEAKING state.
  stopSpeaking();
  speaking = true;
  const words = text.split(/\s+/).length;
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
  if (speakingTimer) {
    window.clearTimeout(speakingTimer);
    speakingTimer = null;
  }
  try {
    window.speechSynthesis?.cancel();
  } catch { /* noop */ }
}

export function isSpeaking() {
  return speaking;
}
