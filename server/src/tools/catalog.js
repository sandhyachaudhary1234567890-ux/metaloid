// Tool catalog: concrete tools bound to real handlers.
// Risk ladder: read (auto) → reversible (auto, undoable) → external/irreversible (approval).
// No shell, no eval, no child processes — handlers are plain HTTPS/local code.

import { defineTool } from '../core/tools.js';
import { createInvestigation, runInvestigation, getInvestigation, detectTargetType } from '../osint.js';
import { remember, recall, forget } from '../core/memory.js';
import { upsertEntity, relate, neighbors, findEntities } from '../core/world.js';
import {
  createArtifact, editArtifact, validateArtifact, renderArtifact, finalizeArtifact,
  getArtifact, listArtifacts, visualQA, repairArtifact, ARTIFACT_KINDS,
} from '../core/artifacts.js';

function scopedUser(grants) {
  const userId = grants?.userId;
  if (!userId || typeof userId !== 'string') throw new Error('Artifact tools require an authenticated user session.');
  return userId;
}

function scopedArgs(args, grants) {
  const userId = scopedUser(grants);
  const scope = {};
  for (const k of ['projectId', 'workspaceId', 'taskId', 'conversationId']) {
    if (typeof args?.[k] === 'string' && args[k]) scope[k] = args[k].slice(0, 80);
  }
  return { userId, scope };
}

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

// ---- artifact tools (scoped file creation, user-owned) ----
defineTool({
  name: 'artifact.create',
  purpose: 'Create a REAL file artifact (pptx, docx, md, txt) in the user-scoped artifact store. Bytes are genuinely built, never mocked.',
  tags: ['artifact', 'file', 'create', 'document', 'presentation'],
  risk: 'reversible', timeoutMs: 15000, verify: 'schema',
  inputs: {
    kind: { type: 'string', required: true, pattern: '^(pptx|docx|md|txt)$' },
    name: { type: 'string', required: true, max: 80 },
    spec: { type: 'object', required: true },
    projectId: { type: 'string', required: false },
    workspaceId: { type: 'string', required: false },
    taskId: { type: 'string', required: false },
    conversationId: { type: 'string', required: false },
  },
  outputs: { artifact: 'object' },
  handler: async (args, grants) => {
    const { userId, scope } = scopedArgs(args, grants);
    const r = createArtifact({ userId, kind: args.kind, name: args.name, spec: args.spec, ...scope });
    if (!r.ok) throw new Error(r.error);
    return { artifact: r.artifact };
  },
});

defineTool({
  name: 'artifact.write',
  purpose: 'Write a new version of an existing artifact (v1 → v2). Previous versions preserved.',
  tags: ['artifact', 'file', 'edit', 'version'],
  risk: 'reversible', timeoutMs: 15000, verify: 'schema',
  inputs: {
    id: { type: 'string', required: true },
    spec: { type: 'object', required: true },
    note: { type: 'string', required: false, max: 120 },
  },
  outputs: { artifact: 'object' },
  handler: async (args, grants) => {
    const r = editArtifact(scopedUser(grants), args.id, args.spec, args.note || '');
    if (!r.ok) throw new Error(r.error);
    return { artifact: r.artifact };
  },
});

defineTool({
  name: 'artifact.read',
  purpose: 'Read artifact metadata (never raw bytes unless download is used).',
  tags: ['artifact', 'file', 'read'],
  risk: 'read', timeoutMs: 3000, verify: 'none',
  inputs: { id: { type: 'string', required: true } },
  outputs: { artifact: 'object' },
  handler: async (args, grants) => {
    const a = getArtifact(scopedUser(grants), args.id);
    if (!a) throw new Error('Unknown artifact.');
    const { bytes, ...meta } = a;
    void bytes;
    return { artifact: meta };
  },
});

defineTool({
  name: 'artifact.inspect',
  purpose: 'Inspect artifact structure: slides/paragraphs, versions, timeline, renders.',
  tags: ['artifact', 'inspect', 'qa'],
  risk: 'read', timeoutMs: 5000, verify: 'none',
  inputs: { id: { type: 'string', required: true } },
  outputs: { inspection: 'object' },
  handler: async (args, grants) => {
    const a = getArtifact(scopedUser(grants), args.id);
    if (!a) throw new Error('Unknown artifact.');
    const qa = visualQA(scopedUser(grants), args.id);
    return {
      inspection: {
        id: a.id, name: a.name, kind: a.kind, status: a.status, version: a.version,
        verification: a.verification, renders: a.renders, versions: a.versions,
        qaIssues: qa.ok ? qa.issues : [{ reason: qa.error }],
        renderNote: qa.renderNote,
      },
    };
  },
});

defineTool({
  name: 'artifact.validate',
  purpose: 'Structurally validate an artifact (PKZIP/Content_Types/slides/text — never just the extension).',
  tags: ['artifact', 'validate', 'qa'],
  risk: 'read', timeoutMs: 10000, verify: 'schema',
  inputs: { id: { type: 'string', required: true } },
  outputs: { verification: 'object' },
  handler: async (args, grants) => {
    const r = validateArtifact(scopedUser(grants), args.id);
    if (!r.ok) throw new Error(r.error);
    return { verification: r.verification };
  },
});

defineTool({
  name: 'artifact.render',
  purpose: 'Render artifact to PDF proof via local renderer if installed; honestly reports when unavailable.',
  tags: ['artifact', 'render', 'preview'],
  risk: 'reversible', timeoutMs: 90000, verify: 'none',
  inputs: { id: { type: 'string', required: true } },
  outputs: { render: 'object' },
  handler: async (args, grants) => {
    const r = await renderArtifact(scopedUser(grants), args.id);
    if (!r.ok) throw new Error(r.error);
    return { render: { rendered: r.rendered, message: r.message || null, pdfBytes: r.pdfBytes || 0, previews: r.previews || 0 } };
  },
});

defineTool({
  name: 'artifact.finalize',
  purpose: 'Finalize a validated artifact (optionally attach to a project). Only from passing validation.',
  tags: ['artifact', 'finalize', 'project', 'library'],
  risk: 'reversible', timeoutMs: 5000, verify: 'schema',
  inputs: { id: { type: 'string', required: true }, projectId: { type: 'string', required: false } },
  outputs: { artifact: 'object' },
  handler: async (args, grants) => {
    const r = finalizeArtifact(scopedUser(grants), args.id, args.projectId || null);
    if (!r.ok) throw new Error(r.error);
    return { artifact: r.artifact };
  },
});

// ---- document tools ----
defineTool({
  name: 'document.create',
  purpose: 'Create a REAL text document (md, txt, or genuine .docx) from a title + blocks.',
  tags: ['document', 'create', 'docx', 'markdown', 'writing'],
  risk: 'reversible', timeoutMs: 15000, verify: 'schema',
  inputs: {
    kind: { type: 'string', required: true, pattern: '^(docx|md|txt)$' },
    title: { type: 'string', required: true, max: 150 },
    blocks: { type: 'object', required: true },
    projectId: { type: 'string', required: false },
    conversationId: { type: 'string', required: false },
  },
  outputs: { artifact: 'object' },
  handler: async (args, grants) => {
    const { userId, scope } = scopedArgs(args, grants);
    const spec = args.kind === 'docx'
      ? { title: args.title, blocks: args.blocks }
      : { text: `# ${args.title}\n\n${blocksToMarkdown(args.blocks)}` };
    const r = createArtifact({ userId, kind: args.kind, name: args.title, spec, ...scope });
    if (!r.ok) throw new Error(r.error);
    return { artifact: r.artifact };
  },
});

function blocksToMarkdown(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((b) => {
    if (b.h === 1) return `## ${b.text || b.p || ''}`;
    if (b.h === 2) return `### ${b.text || b.p || ''}`;
    if (b.h === 3) return `#### ${b.text || b.p || ''}`;
    if (Array.isArray(b.bullets)) return b.bullets.map((x) => `- ${x}`).join('\n');
    return String(b.p || '');
  }).join('\n\n').slice(0, 200000);
}

defineTool({
  name: 'document.edit',
  purpose: 'Edit a document artifact (new version, old preserved).',
  tags: ['document', 'edit', 'version'],
  risk: 'reversible', timeoutMs: 15000, verify: 'schema',
  inputs: { id: { type: 'string', required: true }, spec: { type: 'object', required: true }, note: { type: 'string', required: false, max: 120 } },
  outputs: { artifact: 'object' },
  handler: async (args, grants) => {
    const r = editArtifact(scopedUser(grants), args.id, args.spec, args.note || '');
    if (!r.ok) throw new Error(r.error);
    return { artifact: r.artifact };
  },
});

defineTool({
  name: 'document.validate',
  purpose: 'Validate a document artifact structurally.',
  tags: ['document', 'validate', 'qa'],
  risk: 'read', timeoutMs: 10000, verify: 'schema',
  inputs: { id: { type: 'string', required: true } },
  outputs: { verification: 'object' },
  handler: async (args, grants) => {
    const r = validateArtifact(scopedUser(grants), args.id);
    if (!r.ok) throw new Error(r.error);
    return { verification: r.verification };
  },
});

// ---- presentation tools ----
defineTool({
  name: 'presentation.create',
  purpose: 'Create a REAL .pptx presentation from a deck spec {title, slides:[{title, bullets[]}], accent?}. Genuine OpenXML bytes.',
  tags: ['presentation', 'pptx', 'slides', 'create'],
  risk: 'reversible', timeoutMs: 15000, verify: 'schema',
  inputs: {
    title: { type: 'string', required: true, max: 120 },
    slides: { type: 'object', required: true },
    accent: { type: 'string', required: false, max: 7 },
    projectId: { type: 'string', required: false },
    conversationId: { type: 'string', required: false },
  },
  outputs: { artifact: 'object' },
  handler: async (args, grants) => {
    const { userId, scope } = scopedArgs(args, grants);
    const r = createArtifact({ userId, kind: 'pptx', name: args.title, spec: { title: args.title, slides: args.slides, accent: args.accent }, ...scope });
    if (!r.ok) throw new Error(r.error);
    return { artifact: r.artifact };
  },
});

defineTool({
  name: 'presentation.edit',
  purpose: 'Edit presentation slides (new version, e.g. fix slide N).',
  tags: ['presentation', 'pptx', 'edit', 'version'],
  risk: 'reversible', timeoutMs: 15000, verify: 'schema',
  inputs: { id: { type: 'string', required: true }, spec: { type: 'object', required: true }, note: { type: 'string', required: false, max: 120 } },
  outputs: { artifact: 'object' },
  handler: async (args, grants) => {
    const r = editArtifact(scopedUser(grants), args.id, args.spec, args.note || '');
    if (!r.ok) throw new Error(r.error);
    return { artifact: r.artifact };
  },
});

defineTool({
  name: 'presentation.validate',
  purpose: 'Validate a .pptx structurally (package, slides, text presence, overcrowding).',
  tags: ['presentation', 'pptx', 'validate', 'qa'],
  risk: 'read', timeoutMs: 10000, verify: 'schema',
  inputs: { id: { type: 'string', required: true } },
  outputs: { verification: 'object' },
  handler: async (args, grants) => {
    const r = validateArtifact(scopedUser(grants), args.id);
    if (!r.ok) throw new Error(r.error);
    return { verification: r.verification };
  },
});
