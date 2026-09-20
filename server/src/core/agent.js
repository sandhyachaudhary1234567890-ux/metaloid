// Agent kernel: INTENT → MISSION → PLAN → SKILL → TOOL → VERIFY → MEMORY.
// The model is used for synthesis/classification; all state transitions,
// validation, and permissions are deterministic code (never prompt logic).

import { emit } from './events.js';
import { discoverSkills, skillBrief, getSkill } from './skills.js';
import { createMission, runMission, latestActive, attachReport } from './missions.js';
import { validateTarget } from '../osint.js';
import { verify } from './verify.js';
import { remember } from './memory.js';
import { complete } from '../openrouter.js';
import { renderSystemPrompt, TOOLS_MANIFEST } from '../systemPrompt.js';

export function classifyIntent(text = '') {
  const t = text.toLowerCase().trim();
  if (/^(continue|resume|carry on)\b/.test(t)) return { kind: 'continue' };
  if (/^(investigate|osint|recon)\b/.test(t)) return { kind: 'osint' };
  if (/^(mission|do mission|start mission|build|create|plan|research|analyze|compare|watch|monitor)\b/.test(t)) return { kind: 'mission' };
  if (/^(why did|what failed|what went wrong|show evidence|explain)/.test(t)) return { kind: 'inspect' };
  return { kind: 'chat' };
}

/** Pull an investigable target out of free text (URL → email → domain). */
function extractTargetTarget(objective = '') {
  const gh = objective.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?/i);
  if (gh) {
    const v = validateTarget(gh[0]);
    if (v.ok) return v;
  }
  const em = objective.match(/[\w.-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (em) {
    const v = validateTarget(em[0]);
    if (v.ok) return v;
  }
  const dm = objective.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/i);
  if (dm) {
    const v = validateTarget(dm[1]);
    if (v.ok) return v;
  }
  return null;
}

/** Build a task graph from discovered skills' plan templates.
 *  Deps are positional indices resolved to task ids by createMission.
 *  Where a skill maps to a real tool with valid args, the task CALLS it —
 *  otherwise the step stays a planning note (never fake tool output). */
export function planMission(objective, skillIds) {
  const tasks = [];
  const push = (t, after = []) => {
    tasks.push({ ...t, depIdx: [...after] });
    return tasks.length - 1;
  };
  // anchor: understand
  let last = push({ name: 'Understand objective', skill: null, tool: null, args: {} });
  for (const sid of skillIds.slice(0, 3)) {
    if (sid === 'osint') {
      const v = extractTargetTarget(objective);
      if (v) {
        last = push({
          name: `Collect passive findings on ${v.target}`,
          skill: 'osint', tool: 'osint.investigate', args: { target: v.target },
        }, [last]);
        continue;
      }
    }
    const s = getSkill(sid);
    const steps = s?.planTemplate || [`Apply ${s?.name || sid}`];
    for (const st of steps) {
      last = push({ name: st, skill: sid, tool: null, args: {} }, [last]);
    }
  }
  push({ name: 'Verify outcomes against evidence', skill: null, tool: null, args: {} }, [last]);
  return tasks;
}

export async function startMission({ objective, constraints = [], apiKey, model }) {
  const skillIds = discoverSkills(objective);
  const tasks = planMission(objective, skillIds);
  const m = createMission({ objective, constraints, tasks, skillIds });
  // run async; frontend polls
  runMission(m.id, {}).then(async (done) => {
    if (done && done.status === 'COMPLETED' && apiKey) {
      try {
        const briefs = skillIds.map(skillBrief).filter(Boolean);
        // evidence digest: real tool outputs enter synthesis (truncated, cited)
        const evidence = [];
        for (const t of done.tasks) {
          if (t.status !== 'COMPLETED' || !t.result) continue;
          const inv = t.result.investigation;
          if (inv && Array.isArray(inv.findings)) {
            evidence.push(`Tool ${t.tool} on ${inv.target}: ${inv.findings.length} findings.`);
            for (const f of inv.findings.slice(0, 12)) {
              evidence.push(`- [${f.confidence}] ${f.type}: ${String(f.value).slice(0, 100)} (via ${f.source}; ${String(f.evidence || '').slice(0, 120)})`);
            }
          } else {
            evidence.push(`Tool ${t.tool || t.name}: ${JSON.stringify(t.result).slice(0, 400)}`);
          }
        }
        const { text } = await complete({
          apiKey, model, system: renderSystemPrompt({ userName: 'Aryan', tools: TOOLS_MANIFEST }),
          messages: [{
            role: 'user',
            content: `Mission "${objective}" finished. Task log:\n${done.tasks.map((t) => `- [${t.status}] ${t.name}${t.error ? ` (error: ${t.error})` : ''}`).join('\n')}\n\nEVIDENCE (observed tool outputs — only these may be cited):\n${evidence.length ? evidence.join('\n') : '(no tool evidence collected)'}\nSkills: ${JSON.stringify(briefs.map((b) => b.id))}\nWrite a concise mission report: outcome, evidence with sources, gaps, next action. Cite only the evidence above. Never claim unverified results as verified; say "insufficient evidence" where the bundle is thin.`,
          }],
        });
        const { verify: verifyOutcomes } = await import('./verify.js');
        const v = await verifyOutcomes(text, ['nonempty', 'no-placeholders']);
        attachReport(m.id, text, v);
      } catch { /* synthesis is best-effort; tasks stand alone */ }
    }
  }).catch(() => {});
  emit('agent.mission_started', { id: m.id });
  return m;
}

export async function continueMission() {
  const m = latestActive();
  if (!m) return { ok: false, error: 'No active mission. Start one with "mission: <objective>".' };
  runMission(m.id, {}).catch(() => {});
  return { ok: true, mission: m };
}

/** Critic pass over a draft: propose → attack → revise notes (deterministic checks). */
export async function criticize(draft) {
  const v = await verify(draft, ['nonempty', 'no-placeholders']);
  const questions = [
    'What could be wrong with this result?',
    'Which assumption is weakest?',
    'What evidence contradicts it?',
    'Was the wrong tool used?',
    'What remains unverified?',
  ];
  return { passed: v.passed, checks: v.results, questions };
}
