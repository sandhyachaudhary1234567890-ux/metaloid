// STT placeholder — simulated transcription only.
// TODO(backend): replace with Whisper / browser SpeechRecognition gateway.

import { mockVoiceTranscripts } from '../lib/mockAgent';

export function simulateTranscription(round = 0): Promise<string> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(mockVoiceTranscripts[round % mockVoiceTranscripts.length]);
    }, 1800 + Math.random() * 1200);
  });
}

export function isSTSAvailable() {
  return false; // demo mode
}
