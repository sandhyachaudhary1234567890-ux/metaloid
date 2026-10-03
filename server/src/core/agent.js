// Agent kernel: INTENT → MISSION → PLAN → SKILL → TOOL → VERIFY → MEMORY.
// The model is used for synthesis/classification; all state transitions,
// validation, and permissions are deterministic code (never prompt logic).

import { emit } from './events.js';
import { discoverSkills, skillBrief, getSkill } from './skills.js';
import { createMission, runMission, latestActive, attachReport, appendDecision } from './missions.js';
import { validateTarget } from '../osint.js';
import { verify } from './verify.js';
import { remember } from './memory.js';
import { complete } from '../openrouter.js';
import { renderSystemPrompt, TOOLS_MANIFEST } from '../systemPrompt.js';
import { proposeFollowups } from './skillInitiatives.js';
import { getProfile } from './profiles.js';
import { checkBudget, recordUsage, planCaps } from './entitlements.js';
import { resolveIntentCapability } from './intentCapabilityResolver.js';
import { submitJob } from './jobs.js';

export function classifyIntent(text = '') {
  const t = text.toLowerCase().trim();
  const resolved = resolveIntentCapability(text);
  if (resolved.kind === 'artifact') return { kind: 'artifact', resolution: resolved };
  if (resolved.kind === 'unavailable_artifact') return { kind: 'unavailable_artifact', resolution: resolved };
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

export async function startMission({ userId, objective, constraints = [], apiKey, model, userName }) {
  if (!userId) throw new Error('userId required');
  const skillIds = discoverSkills(objective);
  const tasks = planMission(objective, skillIds);
  const m = await createMission({ userId, objective, constraints, tasks, skillIds });
  // run as a bounded background job; frontend polls mission + job status
  const job = submitJob(userId, 'mission', objective, async () => {
    const done = await runMission(userId, m.id, { userId });
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
          apiKey, model, system: renderSystemPrompt({ userName: userName || 'friend', tools: TOOLS_MANIFEST }),
          messages: [{
            role: 'user',
            content: `Mission "${objective}" finished. Task log:\n${done.tasks.map((t) => `- [${t.status}] ${t.name}${t.error ? ` (error: ${t.error})` : ''}`).join('\n')}\n\nEVIDENCE (observed tool outputs — only these may be cited):\n${evidence.length ? evidence.join('\n') : '(no tool evidence collected)'}\nSkills: ${JSON.stringify(briefs.map((b) => b.id))}\nWrite a concise mission report: outcome, evidence with sources, gaps, next action. Cite only the evidence above. Never claim unverified results as verified; say "insufficient evidence" where the bundle is thin.`,
          }],
        });
        const { verify: verifyOutcomes } = await import('./verify.js');
        const v = await verifyOutcomes(text, ['nonempty', 'no-placeholders']);
        await attachReport(userId, m.id, text, v);
        // Initiative hook: relevant skills become ELIGIBLE follow-ups —
        // policy + budgets decide (suggest / queue / run). Never auto-act
        // on match alone.
        try {
          const prop = await proposeFollowups({ getProfile }, userId, done);
          if (prop.suggestions?.length) {
            const prof = await getProfile(userId);
            await appendDecision(userId, m.id, `Initiative: ${prop.suggestions.map((s) => s.name).join(', ')} relevant to outputs (policy: ${prof.autonomy}, action: ${prop.action}).`);
          }
          if ((prop.action === 'queue' || prop.action === 'run') && prop.framed?.length) {
            for (const f of prop.framed.slice(0, 1)) {
              const b = await checkBudget(userId, 'missions');
              if (!b.ok) {
                await appendDecision(userId, m.id, `Initiative follow-up deferred: ${b.error}`);
                break;
              }
              const caps = planCaps(userId);
              const fm = await createMission({
                userId, objective: f.objective, skillIds: f.skillIds, tasks: planMission(f.objective, []),
                budgets: { maxMs: caps.maxMissionMs, maxSteps: caps.maxMissionSteps },
              });
              await recordUsage(userId, 'missions');
              await appendDecision(userId, m.id, `Initiative follow-up ${prop.action === 'run' ? 'started' : 'queued'}: ${fm.id} (${f.skillIds.join(',')}).`);
              if (prop.action === 'run') submitJob(userId, 'mission', f.objective, () => runMission(userId, fm.id, { userId }));
            }
          }
        } catch { /* initiative is advisory — mission stands alone */ }
      } catch { /* synthesis is best-effort; tasks stand alone */ }
    }
    return { missionId: m.id, status: done ? done.status : 'UNKNOWN' };
  });
  emit('agent.mission_started', { id: m.id });
  return { mission: m, jobId: job.id };
}

export async function continueMission(userId) {
  if (!userId) throw new Error('userId required');
  const m = await latestActive(userId);
  if (!m) return { ok: false, error: 'No active mission. Start one with "mission: <objective>".' };
  const job = submitJob(userId, 'mission', `continue ${m.objective}`.slice(0, 160), () => runMission(userId, m.id, { userId }));
  return { ok: true, mission: m, jobId: job.id };
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
