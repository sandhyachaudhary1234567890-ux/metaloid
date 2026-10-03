// SkillRuntime — test mode, invocation, audit. Wires SkillRegistry →
// AgentRuntime (missions), ToolRegistry (deps), VerificationEngine.
// §46: a skill can NEVER disable security, change authorization, extract
// secrets, touch billing, or override platform policy — such intents are
// refused at invoke time, not just at install.

import { getSkillFor, markSkillUsed } from './skillStore.js';
import { missingDeps } from './skillDiscovery.js';
import { adapterFor, runEntry, adapterStatus } from './skillRuntimes.js';
import { listTools } from './tools.js';
import { emit } from './events.js';

export { adapterStatus };

const FORBIDDEN_INTENT = [
  [/disabl\w*\s+(security|safety|permission|auth|guard)/i, 'disable platform security'],
  [/(change|modif\w*|escalat\w*).{0,30}(authorization|permission|role|admin)/i, 'change authorization'],
  [/(extract|steal|exfiltrat|reveal|dump|read).{0,40}(secret|api\s*keys?|password|token|credential|private[_-]?key)/i, 'extract secrets'],
  [/(billing|subscription|payment|invoice)/i, 'touch billing'],
  [/(override|bypass|ignore).{0,30}(polic|safety|platform)/i, 'override platform policy'],
  [/(unrelated|other users['’]?|another user['’]?).{0,30}(data|memor|file|conversation)/i, 'access unrelated private data'],
];

/** Test mode: static checks + sandboxed dry-run → PASS/FAIL/WARN list. */
export async function testSkill(userId, id, { input = {} } = {}) {
  const s = await getSkillFor(userId, id);
  if (!s) return { ok: false, error: 'Unknown skill.' };
  const checks = [];
  const push = (name, verdict, detail = '') => checks.push({ name, verdict, detail });
  push('manifest', s.name && s.description?.length >= 20 ? 'PASS' : 'FAIL', 'name + 20-char description');
  push('trigger-quality', (s.triggers?.length || (s.description?.length > 60)) ? 'PASS' : 'WARN', 'discovery needs WHAT + WHEN');
  push('permissions-declared', s.permissions ? 'PASS' : 'WARN', JSON.stringify(s.permissions || {}).slice(0, 120));
  push('security-scan', s.security?.risk === 'low' ? 'PASS' : s.security?.risk === 'medium' ? 'WARN' : 'FAIL', `${s.security?.risk} (${(s.security?.findings || []).length} findings)`);
  push('forbidden-intent', scanForbidden(s.instructions).length ? 'FAIL' : 'PASS', '§46 intents');
  const jsEntries = Object.keys(s.scripts || {}).filter((p) => p.endsWith('.js'));
  const otherEntries = Object.keys(s.scripts || {}).filter((p) => !p.endsWith('.js'));
  if (jsEntries.length) {
    const r = runEntry(jsEntries[0], s.scripts[jsEntries[0]], { input });
    push('sandbox-dryrun', r.ok ? 'PASS' : 'FAIL', r.ok ? `ran ${jsEntries[0]}, logs=${r.logs.length}` : r.error);
  } else if (otherEntries.length) {
    const a = adapterFor(otherEntries[0]);
    push('sandbox-dryrun', 'WARN', `${otherEntries[0]}: ${a.kind} is not enabled in this environment (inert, never executed)`);
  } else {
    push('sandbox-dryrun', 'WARN', 'no scripts — knowledge/workflow skill');
  }
  const fails = checks.filter((c) => c.verdict === 'FAIL').length;
  emit('skill.tested', { id, user: userId, fails });
  return { ok: true, skill: id, version: s.version, verdict: fails ? 'FAIL' : checks.some((c) => c.verdict === 'WARN') ? 'WARN' : 'PASS', checks };
}

export function scanForbidden(text) {
  const hits = [];
  const t = String(text || '');
  for (const [re, label] of FORBIDDEN_INTENT) {
    if (re.test(t)) hits.push(label);
  }
  return hits;
}

/**
 * Invoke: relevance already established by caller (discovery or /command).
 * Returns executed result (JS skill) or an honest guided plan (others).
 * NEVER claims execution that did not happen.
 */
export async function invokeSkill(userId, id, { input = {}, available = {}, reason = '' } = {}) {
  const s = await getSkillFor(userId, id);
  if (!s) return { ok: false, error: 'Unknown skill.' };
  if (s.status !== 'enabled') return { ok: false, error: 'Skill is disabled.' };
  const forbidden = scanForbidden(s.instructions);
  if (forbidden.length) return { ok: false, error: `Refused: skill declares forbidden intent (${forbidden.join(', ')}).` };
  const missing = missingDeps(s, available);
  const unmet = [...missing.tools, ...missing.plugins, ...missing.providers];
  if (unmet.length) {
    return {
      ok: false, error: 'Missing dependencies.', missing,
      hint: hintForMissing(missing),
    };
  }
  const knownTools = new Set(listTools().map((t) => t.name));
  const unknownDeclared = (s.tools || []).filter((t) => !knownTools.has(t));
  const jsEntries = Object.keys(s.scripts || {}).filter((p) => p.endsWith('.js')).sort();
  const otherEntries = Object.keys(s.scripts || {}).filter((p) => !p.endsWith('.js')).sort();
  await markSkillUsed(userId, id, reason.slice(0, 120));
  if (jsEntries.length) {
    const r = runEntry(jsEntries[0], s.scripts[jsEntries[0]], { input });
    if (!r.ok) return { ok: false, error: `Skill script failed: ${r.error}`, logs: r.logs, executed: true, entry: jsEntries[0] };
    return { ok: true, executed: true, entry: jsEntries[0], adapter: r.adapter, result: r.result, logs: r.logs, skill: s.id, version: s.version };
  }
  if (otherEntries.length) {
    const a = adapterFor(otherEntries[0]);
    return {
      ok: true, executed: false, skill: s.id, version: s.version, adapter: a.kind,
      plan: {
        skill: s.name,
        instructions: s.instructions.slice(0, 4000),
        references: Object.keys(s.references || {}),
        verification: s.verification,
        unknownDeclaredTools: unknownDeclared,
      },
      note: `${otherEntries[0]}: ${a.kind} is not currently enabled in this environment — script stays inert. Follow the plan, then verify.`,
    };
  }
  // No executable script: guided plan for the agent/user — explicit, not faked.
  return {
    ok: true, executed: false, skill: s.id, version: s.version,
    plan: {
      skill: s.name,
      instructions: s.instructions.slice(0, 4000),
      references: Object.keys(s.references || {}),
      verification: s.verification,
      unknownDeclaredTools: unknownDeclared,
    },
    note: 'Knowledge/workflow skill: no executable script — follow the plan, then verify.',
  };
}

function hintForMissing(missing) {
  const parts = [];
  if (missing.plugins.length) parts.push(`Connect: ${missing.plugins.join(', ')}`);
  if (missing.providers.length) parts.push(`Connect a provider for: ${missing.providers.join(', ')} (BYOK — never shared credentials)`);
  if (missing.tools.length) parts.push(`Unavailable tools: ${missing.tools.join(', ')}`);
  return parts.join(' · ') || 'All dependencies met.';
}
