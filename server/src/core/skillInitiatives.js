// Skill↔InitiativeEngine hook. Skills are ELIGIBLE proactive actions —
// never autonomous merely because they match. The user's autonomy policy
// (passive/assisted/proactive/autonomous) + mission budgets decide:
//   passive/assisted → record a SUGGESTION on the mission (no action)
//   proactive        → create follow-up mission QUEUED (user runs it)
//   autonomous       → create + RUN follow-up (budget-gated)
// InitiativeEngine (missions) remains the authority; this only proposes.

import { discoverFor } from './skillDiscovery.js';
import { emit } from './events.js';

export async function proposeFollowups({ getProfile, createMissionFn }, userId, mission) {
  const profile = getProfile ? await getProfile(userId) : { autonomy: 'assisted' };
  const autonomy = profile.autonomy || 'assisted';
  const ctx = `Report on completed mission: ${mission.objective}. Deliverables, presentation, document, summary, next steps, verify, publish, share.`;
  const cands = discoverFor(userId, ctx, {}).filter((c) => c.auto).slice(0, 2);
  const suggestions = cands.map((c) => ({ skillId: c.skillId, name: c.name, score: c.score, reason: 'relevant to completed mission output' }));
  emit('skill.followups_proposed', { user: userId, mission: mission.id, count: suggestions.length, autonomy });
  if ((autonomy === 'passive' || autonomy === 'assisted') || !suggestions.length) {
    return { action: 'suggested', suggestions };
  }
  // proactive/autonomous: frame follow-up missions (running is the caller's job)
  const framed = suggestions.map((s) => ({
    objective: `Follow-up to "${mission.objective.slice(0, 80)}": apply skill "${s.name}" to the mission outputs, then verify.`,
    skillIds: [s.skillId],
    via: 'initiative',
  }));
  return { action: autonomy === 'autonomous' ? 'run' : 'queue', suggestions, framed, create: createMissionFn || null };
}
