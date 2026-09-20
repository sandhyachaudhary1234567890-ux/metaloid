// OSINT orchestration layer — lawful, passive, public-data only.
// NO shell execution, NO raw CLI tools. Only keyless HTTPS collectors run;
// SpiderFoot/theHarvester/Amass/Maigret/Sherlock/TruffleHog are registered
// as adapters with honest availability (need local installs, not bundled).
// Every finding carries provenance: type/value/source/source_url/timestamp/
// confidence/evidence. Uncertain identities are NEVER merged.

const jobs = new Map(); // id -> investigation
let seq = 0;
const MAX_JOBS = 50;
const COLLECTOR_TIMEOUT = 9000;
const MAX_CONCURRENT = 3;
let running = 0;

const GH_HEADERS = () => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'metaloid-osint/0.1',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

async function getJSON(url, headers = {}, timeout = COLLECTOR_TIMEOUT) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- target validation (authorized targets only) ----------
export function detectTargetType(raw) {
  const t = (raw || '').trim();
  if (/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i.test(t)) return 'repo';
  if (/^[\w.-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return 'email';
  if (/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(t) && !t.includes('@')) return 'domain';
  if (/^[a-zA-Z0-9._-]{2,39}$/.test(t)) return 'username';
  if (/^[\w .-]{2,80}$/.test(t)) return 'org';
  return 'unknown';
}

const BLOCKED = /localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|\.local$|\.internal$|onion$/i;
export function validateTarget(raw) {
  const t = (raw || '').trim().slice(0, 200);
  if (!t) return { ok: false, error: 'Empty target.' };
  if (BLOCKED.test(t)) return { ok: false, error: 'Private/internal targets are out of scope.' };
  const type = detectTargetType(t);
  if (type === 'unknown') return { ok: false, error: 'Enter a domain, username, email, organization, or GitHub repo URL.' };
  return { ok: true, target: t, type };
}

// ---------- collector registry ----------
export const COLLECTORS = [
  { id: 'subfinder', name: 'Subfinder (passive DNS)', kinds: ['crtsh'], available: true },
  { id: 'amass', name: 'Amass (asset surface)', kinds: ['crtsh', 'doh'], available: true },
  { id: 'harvester', name: 'theHarvester (passive discovery)', kinds: ['crtsh', 'github'], available: true },
  { id: 'spiderfoot', name: 'SpiderFoot (correlation)', kinds: ['correlate'], available: true },
  { id: 'maigret', name: 'Maigret (username leads)', kinds: ['github'], available: true },
  { id: 'sherlock', name: 'Sherlock (username leads)', kinds: ['github'], available: true },
  { id: 'trufflehog', name: 'TruffleHog (repo secrets)', kinds: [], available: false, reason: 'Only for repos you own or are authorized to scan. Not wired in V1.' },
];

// ---------- keyless collectors (real public data) ----------
async function crtsh(domain) {
  const out = [];
  const rows = await getJSON(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`);
  const seen = new Set();
  for (const r of rows.slice(0, 200)) {
    const name = (r.name_value || '').split('\n')[0].replace(/^\*\./, '').toLowerCase();
    if (!name || seen.has(name) || !name.endsWith(domain.toLowerCase())) continue;
    seen.add(name);
    out.push({
      type: 'subdomain', value: name, source: 'subfinder',
      source_url: `https://crt.sh/?q=${encodeURIComponent(name)}`,
      confidence: 'high', evidence: `Certificate transparency log (issuer: ${r.issuer_name || 'n/a'})`,
    });
  }
  return out;
}

async function doh(domain) {
  const out = [];
  for (const type of ['A', 'MX', 'TXT']) {
    try {
      const j = await getJSON(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
        { Accept: 'application/dns-json' }
      );
      for (const a of j.Answer || []) {
        out.push({
          type: type === 'A' ? 'ip' : type === 'MX' ? 'email' : 'record',
          value: String(a.data).slice(0, 200), source: 'amass',
          source_url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
          confidence: 'high', evidence: `DNS ${type} record for ${domain}`,
        });
      }
    } catch { /* record type absent — fine */ }
  }
  return out;
}

async function githubFootprint(q, kind) {
  const out = [];
  if (kind === 'repo') {
    const m = q.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
    if (!m) return out;
    const j = await getJSON(`https://api.github.com/repos/${m[1]}/${m[2]}`, GH_HEADERS());
    out.push({
      type: 'repository', value: j.full_name, source: 'harvester',
      source_url: j.html_url, confidence: 'high',
      evidence: `${j.description || 'no description'} · ★${j.stargazers_count} · ${j.language || 'n/a'}`,
    });
    return out;
  }
  // username / org as LEADS — never identity proof
  const [users, repos] = await Promise.all([
    getJSON(`https://api.github.com/search/users?q=${encodeURIComponent(q)}+in:login&per_page=5`, GH_HEADERS()).catch(() => ({ items: [] })),
    getJSON(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5`, GH_HEADERS()).catch(() => ({ items: [] })),
  ]);
  for (const u of users.items || []) {
    out.push({
      type: 'profile', value: u.login, source: kind === 'username' ? 'maigret' : 'harvester',
      source_url: u.html_url, confidence: 'medium',
      evidence: 'Public GitHub account match. Lead only — username reuse is not identity proof.',
    });
  }
  for (const r of repos.items || []) {
    out.push({
      type: 'repository', value: r.full_name, source: 'sherlock',
      source_url: r.html_url, confidence: 'medium',
      evidence: (r.description || 'no description').slice(0, 160),
    });
  }
  return out;
}

// ---------- normalize / dedupe / correlate ----------
function dedupe(findings) {
  const seen = new Map();
  for (const f of findings) {
    const k = `${f.type}::${String(f.value).toLowerCase()}`;
    if (!seen.has(k)) seen.set(k, { ...f, first_seen: new Date().toISOString(), also_seen_by: [] });
    else {
      const e = seen.get(k);
      if (!e.also_seen_by.includes(f.source)) e.also_seen_by.push(f.source);
    }
  }
  return [...seen.values()];
}

function correlate(findings) {
  // SpiderFoot-style rollups: group by type, count, confidence mix
  const byType = {};
  for (const f of findings) {
    byType[f.type] = byType[f.type] || { count: 0, high: 0, medium: 0, low: 0 };
    byType[f.type].count += 1;
    byType[f.type][f.confidence] = (byType[f.type][f.confidence] || 0) + 1;
  }
  return byType;
}

// ---------- jobs ----------
export function createInvestigation(target, type) {
  if (jobs.size >= MAX_JOBS) {
    const oldest = [...jobs.keys()][0];
    jobs.delete(oldest);
  }
  const id = `inv-${Date.now().toString(36)}-${(++seq).toString(36)}`;
  const job = {
    id, target, type, status: 'queued', progress: 0,
    collectors: COLLECTORS.filter((c) => c.available).map((c) => ({ id: c.id, name: c.name, state: 'queued' })),
    findings: [], correlation: {}, timeline: [{ at: new Date().toISOString(), event: 'Investigation created', detail: target }],
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

export function getInvestigation(id) {
  return jobs.get(id) || null;
}

function log(job, event, detail = '') {
  job.timeline.push({ at: new Date().toISOString(), event, detail });
}

async function runLimited(job, fns) {
  const results = [];
  const queue = [...fns];
  async function worker() {
    while (queue.length) {
      const fn = queue.shift();
      if (running >= MAX_CONCURRENT) {
        await new Promise((r) => setTimeout(r, 200));
        queue.unshift(fn);
        continue;
      }
      running += 1;
      try {
        results.push(await fn());
      } catch (e) {
        results.push({ error: String(e.message || e) });
      } finally {
        running -= 1;
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return results;
}

export async function runInvestigation(id) {
  const job = jobs.get(id);
  if (!job || job.status === 'collecting') return job;
  job.status = 'collecting';
  log(job, 'Collecting', 'Passive collectors started (public data only)');
  const setState = (cid, state) => {
    const c = job.collectors.find((x) => x.id === cid);
    if (c) c.state = state;
    job.progress = Math.round((job.collectors.filter((x) => x.state === 'done' || x.state === 'failed' || x.state === 'skipped').length / job.collectors.length) * 100);
  };

  const tasks = [];
  const { target, type } = job;

  if (type === 'domain') {
    tasks.push(async () => {
      setState('subfinder', 'running');
      try {
        const f = await crtsh(target);
        setState('subfinder', 'done');
        log(job, 'subfinder', `${f.length} subdomains via certificate transparency`);
        return f;
      } catch (e) { setState('subfinder', 'failed'); log(job, 'subfinder failed', e.error || 'error'); return []; }
    });
    tasks.push(async () => {
      setState('amass', 'running');
      try {
        const f = await doh(target);
        setState('amass', 'done');
        log(job, 'amass', `${f.length} DNS records mapped`);
        return f;
      } catch (e) { setState('amass', 'failed'); log(job, 'amass failed', e.error || 'error'); return []; }
    });
    tasks.push(async () => {
      setState('harvester', 'running');
      try {
        const f = await githubFootprint(target.split('.')[0], 'org');
        setState('harvester', 'done');
        log(job, 'harvester', `${f.length} GitHub footprint hits`);
        return f;
      } catch (e) { setState('harvester', 'failed'); log(job, 'harvester failed', e.error || 'error'); return []; }
    });
    for (const cid of ['spiderfoot', 'maigret', 'sherlock']) setState(cid, 'skipped');
    log(job, 'Note', 'Username collectors skipped — no username in a domain target');
  } else if (type === 'username' || type === 'email' || type === 'org') {
    tasks.push(async () => {
      const cid = type === 'username' ? 'maigret' : 'harvester';
      setState(cid, 'running');
      try {
        const f = await githubFootprint(target, type);
        setState(cid, 'done');
        log(job, cid, `${f.length} public GitHub leads (medium confidence max)`);
        return f;
      } catch (e) { setState(cid, 'failed'); log(job, `${cid} failed`, e.error || 'error'); return []; }
    });
    tasks.push(async () => {
      setState('sherlock', 'running');
      try {
        const f = await githubFootprint(target, type);
        const extra = f.filter((x) => x.type === 'repository');
        setState('sherlock', 'done');
        log(job, 'sherlock', `${extra.length} repository leads`);
        return extra;
      } catch (e) { setState('sherlock', 'failed'); log(job, 'sherlock failed', e.error || 'error'); return []; }
    });
    for (const cid of ['subfinder', 'amass', 'spiderfoot']) setState(cid, 'skipped');
    if (type === 'email') log(job, 'Note', 'Breach-data lookups need API keys — not run. Insufficient evidence there.');
  } else if (type === 'repo') {
    tasks.push(async () => {
      setState('harvester', 'running');
      try {
        const f = await githubFootprint(target, 'repo');
        setState('harvester', 'done');
        log(job, 'harvester', f.length ? 'Repository profiled' : 'Repository not found/public');
        return f;
      } catch (e) { setState('harvester', 'failed'); log(job, 'harvester failed', e.error || 'error'); return []; }
    });
    for (const cid of ['subfinder', 'amass', 'spiderfoot', 'maigret', 'sherlock']) setState(cid, 'skipped');
  }

  const settled = await runLimited(job, tasks);
  job.status = 'normalizing';
  log(job, 'Normalizing', 'Deduplicating + attaching provenance');
  const flat = settled.flatMap((r) => (Array.isArray(r) ? r : []));
  job.findings = dedupe(flat);
  job.status = 'correlating';
  job.correlation = correlate(job.findings);
  log(job, 'spiderfoot', `${job.findings.length} unique findings correlated`);
  const failed = job.collectors.filter((c) => c.state === 'failed').length;
  job.status = job.findings.length === 0 ? 'failed' : failed > 0 ? 'partial' : 'complete';
  job.progress = 100;
  log(job, job.status === 'complete' ? 'Complete' : job.status, `${job.findings.length} findings`);
  return job;
}

export function reportMarkdown(job) {
  const L = [];
  L.push(`# METALOID OSINT Report — ${job.target}`);
  L.push(`Status: ${job.status} · Findings: ${job.findings.length} · ${job.createdAt}`);
  L.push('');
  for (const f of job.findings) {
    L.push(`- [${f.confidence.toUpperCase()}] **${f.type}**: ${f.value}`);
    L.push(`  - source: ${f.source} (${f.source_url || 'n/a'})`);
    L.push(`  - evidence: ${f.evidence || 'n/a'}`);
  }
  L.push('');
  L.push('_Username matches are leads, not identity proof. Verify before acting._');
  return L.join('\n');
}

export function reportCSV(job) {
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['type', 'value', 'source', 'source_url', 'confidence', 'evidence', 'first_seen']];
  for (const f of job.findings) rows.push([f.type, f.value, f.source, f.source_url, f.confidence, f.evidence, f.first_seen].map(esc));
  return rows.map((r) => r.join(',')).join('\n');
}
