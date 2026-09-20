// Context Compiler & Memory Quality Engine
// retentionScore = relevance × confidence × recency × lastConfirmed
// Age alone never expires a memory.

export type MemoryScope = 'temporary' | 'project' | 'global';
export type MemoryConfidence = 'explicit' | 'confirmed' | 'inferred';
export type MemorySource = 'user' | 'system' | 'research' | 'inferred' | 'companion';
export type ExpirationPolicy = 'until_removed' | 'project_scoped' | 'decay' | 'ttl' | 'consent_required';

export interface RawMemoryItem {
  id: string;
  fact: string;
  scope: MemoryScope;
  confidence: MemoryConfidence;
  timestamp: number;
  lastConfirmedAt?: number;
  lastUsedAt?: number;
  source?: MemorySource;
  sensitive?: boolean;
  ttlMs?: number;
}

export interface CompiledMemoryItem {
  id: string;
  fact: string;
  scope: MemoryScope;
  confidence: MemoryConfidence;
  source: MemorySource;
  relevanceScore: number;
  retentionScore: number;
  createdAt: number;
  lastConfirmedAt: number;
  lastUsedAt: number;
  expirationPolicy: ExpirationPolicy;
  selectionReason: string;
  supersededBy?: string;
}

export interface CompiledContextPacket {
  conversationId: string;
  activeProject?: string;
  rankedMemories: CompiledMemoryItem[];
  resolvedDecisions: Array<{ key: string; decision: string }>;
  purgedStaleCount: number;
  contradictionsResolved: number;
  systemPromptInjection: string;
  selectionTrace: Array<{ id: string; reason: string; retentionScore: number }>;
}

function lexicalRelevance(fact: string, query: string): number {
  const q = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (q.length === 0) return 0.55;
  const f = fact.toLowerCase();
  const hits = q.filter((w) => f.includes(w)).length;
  return Math.min(1, 0.35 + hits / q.length);
}

function confidenceWeight(c: MemoryConfidence): number {
  if (c === 'explicit') return 1;
  if (c === 'confirmed') return 0.85;
  return 0.5;
}

function recencyFactor(lastUsedAt: number, now: number): number {
  const days = (now - lastUsedAt) / 86400000;
  return Math.max(0.05, 1 - days / 180);
}

function lastConfirmedFactor(lastConfirmedAt: number, now: number, confidence: MemoryConfidence): number {
  if (confidence === 'explicit' || confidence === 'confirmed') return 1;
  const days = (now - lastConfirmedAt) / 86400000;
  return Math.max(0.05, 1 - days / 90);
}

function factsConflict(a: string, b: string): boolean {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na === nb) return false;
  const topic = na.split(/\s+/).slice(0, 4).join(' ');
  if (topic.length < 8) return false;
  const shared = topic.split(' ').filter((w) => w.length > 3 && nb.includes(w)).length;
  return shared >= 2 && (na.includes(' not ') || nb.includes(' not ') || /decided on (\w+)/.test(na));
}

export class ContextCompiler {
  static retentionScore(params: {
    relevance: number;
    confidence: number;
    recency: number;
    lastConfirmed: number;
  }): number {
    return params.relevance * params.confidence * params.recency * params.lastConfirmed;
  }

  static compileContext(params: {
    conversationId: string;
    activeProject?: string;
    rawMemories: RawMemoryItem[];
    recentDecisions: Array<{ key: string; decision: string; timestamp: number }>;
    queryIntent: string;
  }): CompiledContextPacket {
    let purgedCount = 0;
    let contradictionsResolved = 0;
    const now = Date.now();

    const valid: RawMemoryItem[] = [];
    for (const m of params.rawMemories) {
      const source = m.source ?? (m.confidence === 'inferred' ? 'inferred' : 'user');

      // Research facts never become personal global memories.
      if (source === 'research' && m.scope === 'global') {
        purgedCount++;
        continue;
      }

      if (m.sensitive && source !== 'user') {
        purgedCount++;
        continue;
      }

      if (m.confidence === 'explicit' || m.confidence === 'confirmed') {
        valid.push(m);
        continue;
      }

      if (m.scope === 'temporary') {
        const ttl = m.ttlMs ?? 86400000;
        if (now - m.timestamp > ttl) {
          purgedCount++;
          continue;
        }
      }

      if (m.scope === 'project' && params.activeProject) {
        valid.push(m);
        continue;
      }

      const relevance = lexicalRelevance(m.fact, params.queryIntent);
      const recency = recencyFactor(m.lastUsedAt ?? m.timestamp, now);
      const confirmed = lastConfirmedFactor(m.lastConfirmedAt ?? m.timestamp, now, m.confidence);
      const score = this.retentionScore({
        relevance,
        confidence: confidenceWeight(m.confidence),
        recency,
        lastConfirmed: confirmed,
      });
      if (score < 0.01) {
        purgedCount++;
        continue;
      }
      valid.push(m);
    }

    const ranked: CompiledMemoryItem[] = valid.map((m) => {
      const source = m.source ?? (m.confidence === 'inferred' ? 'inferred' : 'user');
      const relevance = lexicalRelevance(m.fact, params.queryIntent);
      const conf = confidenceWeight(m.confidence);
      const recency = recencyFactor(m.lastUsedAt ?? m.timestamp, now);
      const lastConfirmed = lastConfirmedFactor(m.lastConfirmedAt ?? m.timestamp, now, m.confidence);
      let retention = this.retentionScore({ relevance, confidence: conf, recency, lastConfirmed });
      if (params.activeProject && m.scope === 'project') retention = Math.min(1, retention + 0.08);

      const expirationPolicy: ExpirationPolicy =
        m.sensitive
          ? 'consent_required'
          : m.confidence === 'explicit' || m.confidence === 'confirmed'
            ? 'until_removed'
            : m.scope === 'project'
              ? 'project_scoped'
              : m.scope === 'temporary'
                ? 'ttl'
                : 'decay';

      const selectionReason = [
        `relevance=${relevance.toFixed(2)}`,
        `confidence=${conf.toFixed(2)}`,
        `recency=${recency.toFixed(2)}`,
        `lastConfirmed=${lastConfirmed.toFixed(2)}`,
        m.scope === 'project' ? 'project-scope' : null,
      ]
        .filter(Boolean)
        .join(' · ');

      return {
        id: m.id,
        fact: m.fact,
        scope: m.scope,
        confidence: m.confidence,
        source,
        relevanceScore: relevance,
        retentionScore: retention,
        createdAt: m.timestamp,
        lastConfirmedAt: m.lastConfirmedAt ?? m.timestamp,
        lastUsedAt: m.lastUsedAt ?? m.timestamp,
        expirationPolicy,
        selectionReason,
      };
    });

    ranked.sort((a, b) => b.retentionScore - a.retentionScore || b.relevanceScore - a.relevanceScore);

    // Confirmed facts supersede conflicting inferred memories.
    for (const confirmed of ranked.filter((m) => m.confidence === 'confirmed' || m.confidence === 'explicit')) {
      for (const inferred of ranked) {
        if (inferred.confidence !== 'inferred') continue;
        if (factsConflict(confirmed.fact, inferred.fact) || inferred.fact === confirmed.fact) {
          inferred.supersededBy = confirmed.id;
          contradictionsResolved++;
        }
      }
    }

    const visible = ranked.filter((m) => !m.supersededBy).slice(0, 8);

    const seenFacts = new Set<string>();
    const deduped = visible.filter((m) => {
      const key = m.fact.toLowerCase().trim();
      if (seenFacts.has(key)) return false;
      seenFacts.add(key);
      return true;
    });

    const decisionMap = new Map<string, { decision: string; timestamp: number }>();
    for (const d of params.recentDecisions) {
      const existing = decisionMap.get(d.key);
      if (existing) {
        contradictionsResolved++;
        if (d.timestamp > existing.timestamp) {
          decisionMap.set(d.key, { decision: d.decision, timestamp: d.timestamp });
        }
      } else {
        decisionMap.set(d.key, { decision: d.decision, timestamp: d.timestamp });
      }
    }

    const resolvedDecisions = Array.from(decisionMap.entries()).map(([key, v]) => ({
      key,
      decision: v.decision,
    }));

    const memoryLines = deduped.slice(0, 5).map((m) => `- [${m.confidence}] ${m.fact}`);
    const decisionLines = resolvedDecisions.map((d) => `- ${d.key}: ${d.decision}`);
    const injection = [
      memoryLines.length > 0 ? `RELEVANT MEMORY:\n${memoryLines.join('\n')}` : '',
      decisionLines.length > 0 ? `ACTIVE DECISIONS:\n${decisionLines.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      conversationId: params.conversationId,
      activeProject: params.activeProject,
      rankedMemories: ranked,
      resolvedDecisions,
      purgedStaleCount: purgedCount,
      contradictionsResolved,
      systemPromptInjection: injection,
      selectionTrace: deduped.map((m) => ({
        id: m.id,
        reason: m.selectionReason,
        retentionScore: m.retentionScore,
      })),
    };
  }
}
