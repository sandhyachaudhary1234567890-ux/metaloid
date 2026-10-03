// Skill packages — parse, validate, security-scan, capability-analyze.
// Upload format (honest, no fake ZIP support): JSON package
// { "skill.md": "<frontmatter+markdown>", "files": { "path": "content" } }
// or the equivalent create-form fields. Binary ZIP uploads are REJECTED
// with a clear error (no silent partial installs).

import { SKILL_TYPES } from './skillStore.js';
import { extractSkillZip, ZIP_LIMITS } from './skillZip.js';

const MAX_FILES = 40;
const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 2_000_000;

/** Minimal YAML-frontmatter parser (simple `key: value` + `- list` only). */
export function parseFrontmatter(text) {
  const m = String(text || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { ok: false, error: 'skill.md must start with YAML frontmatter between --- lines.' };
  const raw = m[1];
  const body = m[2] || '';
  const data = {};
  let cur = null;
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      const v = kv[2].trim();
      if (v === '' || v === '|' || v === '>') {
        cur = kv[1];
        data[cur] = [];
      } else {
        cur = null;
        data[kv[1]] = v.replace(/^['"]|['"]$/g, '');
      }
      continue;
    }
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li && cur && Array.isArray(data[cur])) {
      data[cur].push(li[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    return { ok: false, error: `Unparseable frontmatter line: "${line.trim().slice(0, 60)}". Keep it simple (key: value, - list items).` };
  }
  return { ok: true, data, body };
}

const strList = (v) => [...new Set(Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [])];

export function normalizeManifest(data) {
  return {
    name: String(data.name || '').trim().slice(0, 80),
    description: String(data.description || '').trim().slice(0, 500),
    version: String(data.version || '1.0.0').trim().slice(0, 20),
    author: String(data.author || '').trim().slice(0, 60),
    types: strList(data.types || data.type).filter((t) => SKILL_TYPES.includes(t)),
    capabilities: strList(data.capabilities),
    tools: strList(data.tools),
    triggers: strList(data.triggers || data.keywords),
    command: data.command ? String(data.command).trim().replace(/^\//, '').slice(0, 40) : null,
    license: String(data.license || 'private').slice(0, 60),
    entrypoints: strList(data.entrypoints || data.entrypoint),
    plugins: strList(data.plugins),
    providers: strList(data.providers),
    permissions: {
      filesystem: String(data.filesystem || 'none').slice(0, 20),
      network: String(data.network || 'none').slice(0, 20),
      browser: String(data.browser || 'none').slice(0, 20),
      terminal: String(data.terminal || 'none').slice(0, 20),
      device: String(data.device || 'none').slice(0, 20),
      apis: strList(data.apis),
    },
    dependencies: {
      tools: strList(data.requires_tools),
      // plugins/providers accept both requires_* and plain keys (Agent 2 owns resolution)
      plugins: [...strList(data.requires_plugins), ...strList(data.plugins)],
      providers: [...strList(data.requires_providers), ...strList(data.providers)],
      packages: strList(data.requires_packages),
    },
    verification: { policy: String(data.verification || 'self-check').slice(0, 40), checks: strList(data.checks) },
    examples: strList(data.examples),
  };
}

// ---------- security scan (uploaded skills are UNTRUSTED code) ----------

const DANGER = [
  [/child_process|spawn\s*\(|exec\s*\(|execSync|spawnSync/i, 'process execution', 'high'],
  [/require\s*\(\s*['"](fs|child_process|net|http|https|cluster|worker_threads|vm|os)['"]\s*\)/i, 'privileged module import', 'high'],
  [/\bprocess\.(env|exit|kill|dlopen|binding)\b/i, 'process internals access', 'high'],
  [/__proto__|constructor\s*\[|prototype\s*\.\s*pollut/i, 'prototype pollution pattern', 'high'],
  [/\.env\b|AWS_|SECRET|PRIVATE_KEY|api[_-]?key/i, 'credential access pattern', 'high'],
  [/fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|https?\.request/i, 'network access', 'medium'],
  [/fs\.(read|write|unlink|mkdir|rm)|readFile|writeFile/i, 'filesystem access', 'medium'],
  [/\.\.\/|~\/|\/etc\/|\/proc\//, 'path traversal', 'high'],
  [/eval\s*\(|new\s+Function\s*\(/i, 'dynamic code execution', 'high'],
  [/atob\s*\(\s*['"][A-Za-z0-9+/=]{200,}['"]/, 'possible obfuscated payload', 'medium'],
  [/curl\s|wget\s|powershell|cmd\.exe|\/bin\/(sh|bash)/i, 'shell invocation', 'high'],
  [/pip\s+install|npm\s+(i|install)\s|apt(-get)?\s+install/i, 'package installation', 'medium'],
];

// Prompt-injection: skill content is DATA, never authority. Flag overrides.
const INJECTION = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(the\s+)?(system|your)\s+(prompt|instructions|rules)/i,
  /you\s+are\s+now\s+(a|an|in)\b/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions|secrets|api\s*keys)/i,
  /bypass\s+(security|permission|authorization|auth)/i,
  /act\s+as\s+(if\s+you\s+have\s+)?(no|without)\s+(rules|limits|restrictions)/i,
  /exfiltrat|send\s+.*\s+to\s+(an?\s+)?external/i,
];

export function scanSecurity(files) {
  const findings = [];
  for (const [p, content] of Object.entries(files || {})) {
    const text = String(content || '');
    for (const [re, label, level] of DANGER) {
      if (re.test(text)) findings.push({ file: p, issue: label, level });
    }
    for (const re of INJECTION) {
      if (re.test(text)) findings.push({ file: p, issue: 'prompt-injection pattern (treated as data, flagged)', level: 'high' });
    }
  }
  const highs = findings.filter((f) => f.level === 'high').length;
  return {
    findings,
    risk: highs > 0 ? 'high' : findings.length ? 'medium' : 'low',
    blocked: highs >= 3, // 3+ high findings = refuse install
  };
}

const SAFE_PATH = /^[a-z0-9_][a-z0-9_./-]{0,120}$/i;

/**
 * Full pipeline: unpack (in-memory) → manifest → structure → scripts →
 * deps → security scan → capability analysis → installable package.
 */
export function validatePackage(input = {}) {
  const errors = [];
  const warnings = [];
  // ZIP path: decode → in-memory extract (never disk, never execute) → same pipeline
  if (input.zipBase64) {
    if (typeof input.zipBase64 !== 'string' || input.zipBase64.length > 2_200_000) {
      return { ok: false, errors: ['Archive payload too large.'], warnings: [] };
    }
    let extracted;
    try {
      extracted = extractSkillZip(Buffer.from(input.zipBase64, 'base64'));
    } catch (e) {
      return { ok: false, errors: [`ZIP rejected: ${e.message}`], warnings: [] };
    }
    input = { ...input, 'skill.md': extracted['skill.md'], files: { ...(extracted.files || {}), ...(input.files || {}) } };
    warnings.push(`Unpacked ZIP (${Object.keys(extracted.files || {}).length + 1} files) in memory — nothing executed.`);
  }
  const skillMd = input['skill.md'] || input.skillMd || input.skill_md;
  if (typeof skillMd !== 'string' || !skillMd.trim()) {
    return { ok: false, errors: ['Missing skill.md (required).'], warnings: [] };
  }
  const files = { ...(input.files || {}) };
  // allow flat { "skill.md": ..., "references/x.md": ... } shape too
  for (const [k, v] of Object.entries(input)) {
    if (['skill.md', 'skillMd', 'skill_md', 'format', 'filename', 'files', 'zipBase64', 'scope', 'workspaceId', 'projectId', 'note'].includes(k)) continue;
    if (typeof v === 'string') files[k] = v;
  }
  const names = Object.keys(files);
  if (names.length > MAX_FILES) errors.push(`Too many files (${names.length} > ${MAX_FILES}).`);
  let total = skillMd.length;
  for (const [p, c] of Object.entries(files)) {
    if (!SAFE_PATH.test(p) || p.includes('..')) errors.push(`Unsafe path rejected: ${p}`);
    if (typeof c !== 'string') errors.push(`Non-text file rejected: ${p}`);
    else {
      if (c.length > MAX_FILE_BYTES) errors.push(`File too large: ${p}`);
      total += c.length;
    }
  }
  if (total > MAX_TOTAL_BYTES) errors.push('Package too large.');
  if (errors.length) return { ok: false, errors, warnings };

  const fm = parseFrontmatter(skillMd);
  if (!fm.ok) return { ok: false, errors: [fm.error], warnings };
  const m = normalizeManifest(fm.data);
  if (!m.name) errors.push('Frontmatter needs a name.');
  if (!m.description || m.description.length < 20) {
    errors.push('Frontmatter needs a description (20+ chars) — discovery depends on it. Say WHAT it does and WHEN it activates.');
  }
  if (!/^\d+\.\d+\.\d+/.test(m.version)) warnings.push(`Version "${m.version}" is not semver — stored as-is.`);
  if (!m.types.length) {
    m.types = ['knowledge'];
    warnings.push('No types declared — defaulting to knowledge.');
  }
  if (!fm.body.trim()) warnings.push('skill.md has no instruction body — only metadata will load.');

  // split body sections (instructions vs embedded examples)
  const instructions = fm.body.trim().slice(0, 30000);

  // scripts = executable entries under scripts/ (js only for now)
  const scripts = {};
  const references = {};
  for (const [p, c] of Object.entries(files)) {
    if (p.startsWith('scripts/')) {
      if (!p.endsWith('.js')) warnings.push(`${p}: only .js scripts execute in the sandbox — others install as inert reference.`);
      scripts[p] = String(c).slice(0, MAX_FILE_BYTES);
    } else {
      references[p] = String(c).slice(0, MAX_FILE_BYTES);
    }
  }

  // capability analysis: tool refs vs known catalog names (advisory, not blocking)
  const unknownTools = (m.tools || []).filter((t) => typeof t !== 'string' || !t.includes('.'));
  if (unknownTools.length) warnings.push(`Tool names should look like "scope.name": ${unknownTools.slice(0, 5).join(', ')}`);

  const security = scanSecurity({ 'skill.md': skillMd, ...files });
  if (security.blocked) {
    return { ok: false, errors: [`Security scan BLOCKED install: ${security.findings.filter((f) => f.level === 'high').length} high-risk findings (shell/process/credential/traversal patterns).`], warnings, security };
  }
  if (security.risk !== 'low') warnings.push(`Security risk: ${security.risk} (${security.findings.length} findings — inspect before enabling).`);

  return {
    ok: errors.length === 0, errors, warnings,
    package: {
      manifest: m, instructions, references, scripts,
      files: { 'skill.md': skillMd.slice(0, 100000), ...files },
      security,
    },
  };
}

/** Create-form → package input (same pipeline, same scans). */
export function packageFromFields({ name, description, instructions = '', types = ['knowledge'], triggers = '', tools = '', command = '' }) {
  const trig = String(triggers).split(',').map((x) => x.trim()).filter(Boolean).join(', ');
  const skillMd = `---\nname: ${String(name || '').slice(0, 80)}\ndescription: ${String(description || '').slice(0, 500)}\nversion: 1.0.0\ntypes: ${(Array.isArray(types) ? types : [types]).join(', ')}\ntriggers: ${trig}\ntools: ${String(tools)}\n${command ? `command: ${String(command).replace(/^\//, '').slice(0, 40)}\n` : ''}---\n\n${String(instructions || '').slice(0, 30000)}\n`;
  return { 'skill.md': skillMd };
}
