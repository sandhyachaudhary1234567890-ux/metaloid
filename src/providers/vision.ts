import { mockVisionAnswers } from '../lib/mockAgent';

export async function analyzeImage(_hint = ''): Promise<string> {
  await new Promise((r) => setTimeout(r, 1400 + Math.random() * 800));
  return mockVisionAnswers[Math.floor(Math.random() * mockVisionAnswers.length)];
}

export const visionStates = ['Scanning…', 'Looking…', 'Analyzing…', 'I can see…', 'Ready'] as const;
