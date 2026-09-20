// Skill runtime: registry + discovery. Skills are capability packages;
// the constitution lives in the system prompt, never duplicated here.
// Discovery returns compact briefs (manifests), not full logic — context stays lean.

const registry = new Map();

export function defineSkill(manifest) {
  if (!manifest?.id || !manifest?.name) throw new Error('Skill needs id + name');
  registry.set(manifest.id, {
    version: '1.0.0',
    securityLevel: 0,
    executionPolicy: 'read-first',
    verificationPolicy: 'self-check',
    dependencies: [],
    ...manifest,
  });
}

export function listSkills() {
  return [...registry.values()].map((s) => ({
    id: s.id, name: s.name, description: s.description,
    capabilities: s.capabilities || [], tools: s.tools || [],
    securityLevel: s.securityLevel, version: s.version,
  }));
}

export function getSkill(id) {
  return registry.get(id) || null;
}

/** Keyword discovery → ranked skill ids. Deterministic, no model needed. */
export function discoverSkills(text = '') {
  const t = text.toLowerCase();
  const scored = [];
  for (const s of registry.values()) {
    let score = 0;
    const hay = `${s.id} ${s.name} ${s.description} ${(s.capabilities || []).join(' ')} ${(s.keywords || []).join(' ')}`.toLowerCase();
    for (const w of t.split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
      if (hay.includes(w)) score += w.length > 5 ? 2 : 1;
    }
    if (score > 0) scored.push({ id: s.id, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.id);
}

/** Compact brief injected into mission/planning context. */
export function skillBrief(id) {
  const s = registry.get(id);
  if (!s) return null;
  return {
    id: s.id, name: s.name, description: s.description,
    capabilities: s.capabilities, tools: s.tools,
    inputSchema: s.inputSchema, outputSchema: s.outputSchema,
    securityLevel: s.securityLevel, verificationPolicy: s.verificationPolicy,
  };
}
