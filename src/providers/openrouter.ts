// Future OpenRouter integration placeholder.
// TODO(backend): replace mock fns with fetch to gateway that injects OPENROUTER_API_KEY server-side.
// Never put API keys in frontend code. All fns below are local mocks.

import { planResponse } from '../lib/mockAgent';
import { streamText } from '../lib/mockStreaming';

export async function sendToOpenRouter(prompt: string): Promise<string> {
  // TODO: POST /api/llm { model, messages } -> return text
  return planResponse(prompt).response;
}

export async function streamFromOpenRouter(
  prompt: string,
  onToken: (partial: string) => void
): Promise<string> {
  // TODO: SSE/WebSocket stream from gateway; pipe tokens to onToken
  const full = planResponse(prompt).response;
  return streamText(full, onToken);
}

export async function analyzeWithVision(_imageHint: string): Promise<string> {
  // TODO: POST /api/vision { image, prompt }
  return 'Demo analysis: vision provider not connected. This is a local placeholder response.';
}
