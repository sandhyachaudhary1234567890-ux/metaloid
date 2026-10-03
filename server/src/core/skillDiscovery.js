// SkillDiscoveryEngine — task → ranked candidate skills.
// Inputs: user task, project context, visible skills, descriptions.
// Output: candidates with relevance score + missing tools/permissions.
// Deterministic keyword scoring (no model call): description ×3, triggers
// ×2, name/capabilities ×1. Project-preferred skills get a boost.
// Auto-activation threshold is explicit and conservative.

import { visibleSkills } from './skillStore.js';
import { listTools } from './tools.js';

export const AUTO_THRESHOLD = 6;

function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length > 2)
    // light plural normalization, applied to BOTH sides consistently
    .map((x) => (x.endsWith('sses') ? x.slice(0, -2) : x.endsWith('s') && x.length > 4 && !x.endsWith('ss') ? x.slice(0, -1) : x));
}

function scoreSkill(skill, task, words, projectSkills = []) {
  const desc = tokens(skill.description);
  const trig = tokens([...(skill.triggers || [])].join(' '));
  const nameCap = tokens(`${skill.name} ${(skill.capabilities || []).join(' ')}`);
  let score = 0;
  const hits = [];
  for (const w of new Set(words)) {
    const weight = w.length > 5 ? 2 : 1;
    if (desc.includes(w)) {
      score += 3 * weight;
      hits.push(w);
    } else if (trig.includes(w)) {
      score += 2 * weight;
      hits.push(w);
    } else if (nameCap.includes(w)) {
      score += 1 * weight;
      hits.push(w);
    }
  }
  // exact trigger-phrase bonus: the TASK itself must contain the phrase
  // (or share 2+ of its words) — never score triggers against themselves.
  const taskLow = String(task || '').toLowerCase();
  const taskSet = new Set(words);
  for (const t of skill.triggers || []) {
    const tl = String(t).toLowerCase();
    if (tl.includes(' ') && tl.length > 8) {
      if (taskLow.includes(tl)) score += 3;
      else {
        const overlap = tl.split(/[^a-z0-9]+/).filter((x) => x.length > 2 && taskSet.has(x)).length;
        if (overlap >= 2) score += 2;
      }
    }
  }
  if (projectSkills.includes(skill.id)) score += 3;
  return { score, hits: [...new Set(hits)].slice(0, 8) };
}

export async function discoverFor(userId, task, { workspaceId = null, projectId = null, projectSkills = [], limit = 5 } = {}) {
  const words = tokens(task);
  if (!words.length) return [];
  const out = [];
  for (const s of await visibleSkills(userId, { workspaceId, projectId })) {
    if (s.status !== 'enabled') continue;
    const { score, hits } = scoreSkill(s, task, words, projectSkills);
    if (score <= 0) continue;
    out.push({
      skillId: s.id, name: s.name, score, hits,
      // auto needs BOTH relevance AND specificity: one generic shared word
      // (e.g. "presentation") must never fire a skill by itself.
      auto: score >= AUTO_THRESHOLD && hits.length >= 2,
      missing: missingDeps(s),
      types: s.types, command: s.command || null,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Dependency check BEFORE execution: tools, plugins, providers.
 * Blocking = hard requirements (dependencies.*) absent from BOTH the
 * caller's available set AND the real ToolRegistry. Declared skill.tools
 * that match nothing are reported as ADVISORY (unresolvedTools) — they
 * never block a skill whose executable entry runs standalone. */
export function missingDeps(skill, available = {}) {
  const missing = { tools: [], plugins: [], providers: [], unresolvedTools: [] };
  let registryTools = new Set();
  try {
    registryTools = new Set(listTools().map((t) => t.name));
  } catch {
    registryTools = new Set();
  }
  const haveTools = new Set([...(available.tools || []), ...registryTools]);
  const havePlugins = new Set(available.plugins || []);
  const haveProviders = new Set(available.providers || []);
  for (const t of skill.dependencies?.tools || []) if (!haveTools.has(t)) missing.tools.push(t);
  for (const t of skill.tools || []) {
    if (!haveTools.has(t) && !registryTools.has(t)) missing.unresolvedTools.push(t);
  }
  for (const p of skill.dependencies?.plugins || []) if (!havePlugins.has(p)) missing.plugins.push(p);
  for (const p of skill.dependencies?.providers || []) if (!haveProviders.has(p)) missing.providers.push(p);
  missing.tools = [...new Set(missing.tools)];
  missing.unresolvedTools = [...new Set(missing.unresolvedTools)];
  return missing;
}

export async function findByCommand(userId, command) {
  const c = String(command || '').replace(/^\//, '').toLowerCase();
  if (!c) return null;
  for (const s of await visibleSkills(userId)) {
    if (s.status === 'enabled' && s.command && s.command.toLowerCase() === c) return s;
  }
  return null;
}
