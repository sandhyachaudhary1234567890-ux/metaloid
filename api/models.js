// The catalogue is what the router will actually try; availability is verified
// per request upstream (dead free slugs are skipped, never served as if live).
import { guard, CANDIDATE_MODELS } from './_shared.js';

const DESCRIPTIONS = {
  'meta-llama/llama-3.3-70b-instruct:free': { name: 'Llama 3.3 70B', tier: 'smart' },
  'qwen/qwen-2.5-coder-32b-instruct:free': { name: 'Qwen 2.5 Coder 32B', tier: 'coding' },
  'google/gemini-2.0-flash-exp:free': { name: 'Gemini 2.0 Flash', tier: 'fast' },
  'mistralai/mistral-small-24b-instruct-2501:free': { name: 'Mistral Small 24B', tier: 'balanced' },
};

export default async function handler(req, res) {
  if (!guard(req, res, { methods: ['GET'] })) return;
  res.json({
    provider: process.env.OPENROUTER_API_KEY ? 'openrouter' : null,
    free: true,
    note: 'Free models first. Availability is checked when you send a message; dead models are skipped automatically.',
    models: CANDIDATE_MODELS.map((id) => ({ id, free: true, ...(DESCRIPTIONS[id] || {}) })),
  });
}
