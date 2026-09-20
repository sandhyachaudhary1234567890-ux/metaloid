// OSINT skill: orchestrator over the tool fabric + entity resolution,
// evidence graph, timeline states. Lawful/passive/authorized only.
// Username matches are ALWAYS leads (≤ medium), never merged as identity.

import { defineSkill } from '../core/skills.js';
import { resolveLevel, upsertEntity, relate } from '../core/world.js';

defineSkill({
  id: 'osint',
  name: 'OSINT Intelligence',
  description: 'Passive public-source investigation: domains, DNS, certificates, GitHub footprint, entity correlation with provenance.',
  keywords: ['investigate', 'osint', 'recon', 'domain', 'subdomain', 'username', 'footprint', 'github', 'certificate', 'dns', 'intelligence'],
  capabilities: ['subdomain_discovery', 'dns_mapping', 'github_footprint', 'entity_resolution', 'evidence_graph', 'timeline', 'reporting'],
  tools: ['osint.investigate', 'osint.subdomains', 'osint.dns', 'osint.github'],
  inputSchema: { target: 'domain | username | email | organization | repo URL (owned/authorized)' },
  outputSchema: { findings: 'normalized[]', entities: 'resolved[]', timeline: 'events[]', report: 'markdown' },
  securityLevel: 1,
  executionPolicy: 'read-only; no active probing beyond public resolvers',
  verificationPolicy: 'provenance-present + no-absolute-identity',
  planTemplate: [
    'Validate target scope and authorization',
    'Collect passive findings (CT, DNS, GitHub)',
    'Normalize + dedupe + attach provenance',
    'Resolve entities (MATCHED only merges)',
    'Correlate + timeline + confidence',
    'Report with evidence and gaps',
  ],
});

/** Resolve a candidate name against known entities without merging. */
export function resolveEntity(type, name, known = []) {
  let best = { level: 'UNRELATED', entity: null };
  for (const e of known) {
    const level = resolveLevel(name, e.name);
    const rank = { UNRELATED: 0, POSSIBLE: 1, PROBABLE: 2, MATCHED: 3 }[level];
    const bestRank = { UNRELATED: 0, POSSIBLE: 1, PROBABLE: 2, MATCHED: 3 }[best.level];
    if (rank > bestRank) best = { level, entity: e };
  }
  return best;
}

/** Fold normalized findings into the world model with evidence edges. */
export function ingestFindings(target, findings = []) {
  const targetEnt = upsertEntity({ type: 'investigation', name: target, source: 'osint-skill' });
  const edges = [];
  for (const f of findings.slice(0, 200)) {
    const ent = upsertEntity({
      type: f.type, name: String(f.value).slice(0, 160),
      source: f.source, confidence: f.confidence,
    });
    const r = relate(targetEnt.id, ent.id, `observed:${f.type}`, {
      source: f.source, confidence: f.confidence, evidence: f.evidence || '',
    });
    if (r.ok) edges.push(r.edge);
  }
  return { target: targetEnt, edges: edges.length };
}
