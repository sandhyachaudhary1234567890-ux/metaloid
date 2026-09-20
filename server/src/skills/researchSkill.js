// Research skill: evidence-first investigation over public sources.
// Distinguishes confirmed facts / reported claims / analysis / unknowns.
// Never manufactures certainty from source quantity.

import { defineSkill } from '../core/skills.js';

defineSkill({
  id: 'research',
  name: 'Web Research',
  description: 'Structured public research: define, gather, cross-check, separate fact from interpretation, conclude with calibrated confidence.',
  keywords: ['research', 'compare', 'analyze', 'explain', 'what is', 'summarize', 'study', 'report', 'find out'],
  capabilities: ['question_decomposition', 'source_gathering', 'cross_check', 'conflict_detection', 'timeline', 'evidence_summary'],
  tools: ['research.wikipedia'],
  inputSchema: { question: 'string', depth: 'quick | standard | deep' },
  outputSchema: { facts: 'string[]', claims: 'string[]', unknowns: 'string[]', confidence: 'KNOWN|LIKELY|UNCERTAIN' },
  securityLevel: 0,
  executionPolicy: 'read-only public sources',
  verificationPolicy: 'cross-check important claims',
  planTemplate: [
    'Define + decompose the question',
    'Gather highest-value public sources',
    'Cross-check important claims; flag conflicts',
    'Separate fact / analysis / uncertainty',
    'Conclude with calibrated confidence + gaps',
  ],
});

/** Correlate two source extracts: agreement, conflict, or insufficient overlap. */
export function correlateExtracts(a, b) {
  const tok = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3));
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return { verdict: 'UNVERIFIED', detail: 'empty extract' };
  let overlap = 0;
  for (const t of A) if (B.has(t)) overlap += 1;
  const ratio = overlap / Math.max(A.size, B.size);
  if (ratio > 0.35) return { verdict: 'CORROBORATED', detail: `${Math.round(ratio * 100)}% term overlap` };
  if (ratio > 0.12) return { verdict: 'REPORTED', detail: 'partial overlap — treat as single-source claim' };
  return { verdict: 'DISPUTED', detail: 'sources diverge — preserve disagreement, do not merge narratives' };
}
