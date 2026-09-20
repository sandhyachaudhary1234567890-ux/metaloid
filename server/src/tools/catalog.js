// Tool catalog: concrete tools bound to real handlers.
// Risk ladder: read (auto) → reversible (auto, undoable) → external/irreversible (approval).
// No shell, no eval, no child processes — handlers are plain HTTPS/local code.

import { defineTool } from '../core/tools.js';
import { createInvestigation, runInvestigation, getInvestigation, detectTargetType } from '../osint.js';
import { remember, recall, forget } from '../core/memory.js';
import { upsertEntity, relate, neighbors, findEntities } from '../core/world.js';

async function httpsJSON(url, headers = {}, timeoutMs = 9000) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---- OSINT tools (read-only, passive) ----
defineTool({
  name: 'osint.subdomains',
  purpose: 'Passive subdomain discovery via certificate transparency for a domain you own or are authorized to investigate.',
  tags: ['osint', 'domain', 'subdomain', 'recon'],
  risk: 'read', timeoutMs: 12000, verify: 'provenance-present',
  inputs: { domain: { type: 'string', required: true, max: 120, pattern: '^[a-z0-9.-]+\\.[a-z]{2,}$' } },
  outputs: { findings: 'array' },
  handler: async ({ domain }) => {
    const rows = await httpsJSON(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`);
    const seen = new Set();
    const out = [];
    for (const r of rows.slice(0, 150)) {
      const name = String(r.name_value || '').split('\n')[0].replace(/^\*\./, '').toLowerCase();
      if (!name || seen.has(name) || !name.endsWith(domain.toLowerCase())) continue;
      seen.add(name);
      out.push({ type: 'subdomain', value: name, source: 'subfinder', source_url: `https://crt.sh/?q=${encodeURIComponent(name)}`, confidence: 'high', evidence: `CT log (issuer: ${r.issuer_name || 'n/a'})` });
    }
    return { findings: out };
  },
});

defineTool({
  name: 'osint.dns',
  purpose: 'Read public DNS records (A/MX/TXT) for a domain via DNS-over-HTTPS.',
  tags: ['osint', 'dns', 'domain'],
  risk: 'read', timeoutMs: 12000, verify: 'provenance-present',
  inputs: { domain: { type: 'string', required: true, max: 120, pattern: '^[a-z0-9.-]+\\.[a-z]{2,}$' } },
  outputs: { findings: 'array' },
  handler: async ({ domain }) => {
    const out = [];
    for (const type of ['A', 'MX', 'TXT']) {
      try {
        const j = await httpsJSON(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, { Accept: 'application/dns-json' });
        for (const a of j.Answer || []) {
          out.push({ type: type === 'A' ? 'ip' : type === 'MX' ? 'email' : 'record', value: String(a.data).slice(0, 200), source: 'amass', source_url: `https://cloudflare-dns.com/dns-query?name=${domain}&type=${type}`, confidence: 'high', evidence: `DNS ${type} for ${domain}` });
        }
      } catch { /* absent — fine */ }
    }
    return { findings: out };
  },
});

defineTool({
  name: 'osint.github',
  purpose: 'Public GitHub footprint: repos, accounts (leads only), repo profiles. No private data.',
  tags: ['osint', 'github', 'username', 'repo'],
  risk: 'read', timeoutMs: 12000, verify: 'no-absolute-identity',
  inputs: { query: { type: 'string', required: true, max: 120 } },
  outputs: { findings: 'array' },
  handler: async ({ query }) => {
    const H = { Accept: 'application/vnd.github+json', 'User-Agent': 'metaloid-osint/0.1' };
    const kind = /^https?:\/\/github\.com\//i.test(query) ? 'repo' : detectTargetType(query);
    if (kind === 'repo') {
      const m = query.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
      const j = await httpsJSON(`https://api.github.com/repos/${m[1]}/${m[2]}`, H);
      return { findings: [{ type: 'repository', value: j.full_name, source: 'harvester', source_url: j.html_url, confidence: 'high', evidence: `${j.description || 'no description'} · ★${j.stargazers_count}` }] };
    }
    const [users, repos] = await Promise.all([
      httpsJSON(`https://api.github.com/search/users?q=${encodeURIComponent(query)}+in:login&per_page=5`, H).catch(() => ({ items: [] })),
      httpsJSON(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`, H).catch(() => ({ items: [] })),
    ]);
    const out = [];
    for (const u of users.items || []) {
      out.push({ type: 'profile', value: u.login, source: 'maigret', source_url: u.html_url, confidence: 'medium', evidence: 'Public account match. Lead only — not identity proof.' });
    }
    for (const r of repos.items || []) {
      out.push({ type: 'repository', value: r.full_name, source: 'sherlock', source_url: r.html_url, confidence: 'medium', evidence: (r.description || 'no description').slice(0, 160) });
    }
    return { findings: out };
  },
});

defineTool({
  name: 'osint.investigate',
  purpose: 'Run a full passive investigation (subdomains+DNS+GitHub as applicable) with normalization, dedupe, correlation.',
  tags: ['osint', 'mission', 'recon', 'investigate'],
  risk: 'read', timeoutMs: 60000, verify: 'provenance-present',
  inputs: { target: { type: 'string', required: true, max: 200 } },
  outputs: { investigation: 'object' },
  handler: async ({ target }) => {
    const { validateTarget } = await import('../osint.js');
    const v = validateTarget(target);
    if (!v.ok) throw new Error(v.error);
    const job = createInvestigation(v.target, v.type);
    await runInvestigation(job.id);
    return { investigation: getInvestigation(job.id) };
  },
});

// ---- research tools (read-only, public) ----
defineTool({
  name: 'research.wikipedia',
  purpose: 'Fetch a factual summary from Wikipedia for research grounding.',
  tags: ['research', 'facts', 'summary'],
  risk: 'read', timeoutMs: 10000, verify: 'none',
  inputs: { topic: { type: 'string', required: true, max: 120 } },
  outputs: { summary: 'string', url: 'string' },
  handler: async ({ topic }) => {
    const j = await httpsJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`, { Accept: 'application/json' });
    return { summary: String(j.extract || '').slice(0, 1500), url: j.content_urls?.desktop?.page || '' };
  },
});

// ---- memory tools (local, reversible) ----
defineTool({
  name: 'memory.save',
  purpose: 'Save durable user context (preference, project, decision). Never secrets.',
  tags: ['memory', 'personal'],
  risk: 'reversible', timeoutMs: 3000, verify: 'none',
  inputs: {
    content: { type: 'string', required: true, max: 500 },
    class: { type: 'string', required: false },
    confidence: { type: 'string', required: false },
  },
  outputs: { record: 'object' },
  handler: async ({ content, cls = 'semantic', confidence = 'medium' }) => remember({ cls, content, source: 'agent', confidence }),
});

defineTool({
  name: 'memory.recall',
  purpose: 'Recall saved context by class and query.',
  tags: ['memory', 'personal'],
  risk: 'read', timeoutMs: 3000, verify: 'none',
  inputs: { query: { type: 'string', required: false }, class: { type: 'string', required: false } },
  outputs: { records: 'array' },
  handler: async ({ query = '', cls } = {}) => ({ records: recall({ query, cls }) }),
});

// ---- world-model tools (local, reversible) ----
defineTool({
  name: 'world.upsert',
  purpose: 'Record an entity (project, goal, system, person-lead) in the world model.',
  tags: ['world', 'entities'],
  risk: 'reversible', timeoutMs: 3000, verify: 'none',
  inputs: { type: { type: 'string', required: true, max: 40 }, name: { type: 'string', required: true, max: 160 } },
  outputs: { entity: 'object' },
  handler: async ({ type, name }) => ({ entity: upsertEntity({ type, name, source: 'agent' }) }),
});

defineTool({
  name: 'world.relate',
  purpose: 'Record a provenance-carrying relationship between two entities.',
  tags: ['world', 'graph'],
  risk: 'reversible', timeoutMs: 3000, verify: 'none',
  inputs: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, rel: { type: 'string', required: true, max: 60 } },
  outputs: { edge: 'object' },
  handler: async ({ from, to, rel }) => relate(from, to, rel, { source: 'agent' }),
});

defineTool({
  name: 'world.explore',
  purpose: 'Explore entity neighborhoods (graph traversal).',
  tags: ['world', 'graph'],
  risk: 'read', timeoutMs: 3000, verify: 'none',
  inputs: { id: { type: 'string', required: true }, depth: { type: 'number', required: false } },
  outputs: { graph: 'object' },
  handler: async ({ id, depth = 1 }) => ({ graph: neighbors(id, Math.min(depth || 1, 3)) }),
});
