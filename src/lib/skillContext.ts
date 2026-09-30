import { discoverSkills, fetchSkill } from './transport';
import { uid } from './storage';

export interface SkillCtx {
  name: string;
  description: string;
  instructions: string;
}

export interface SkillSeed {
  id: string;
  tool: string;
  label: string;
  detail?: string;
  state: 'running' | 'done';
}

/**
 * Shared discovery path for typed chat AND voice (single implementation —
 * no voice-specific duplicate). Strong match → L2 instructions for this
 * turn only; otherwise metadata never enters context.
 */
export async function resolveSkillContext(
  backendUrl: string,
  text: string
): Promise<{ skillCtx: SkillCtx[]; skillSeed: SkillSeed[] }> {
  const empty = { skillCtx: [], skillSeed: [] };
  const clean = text.trim();
  if (clean.length <= 12) return empty;
  try {
    const cands = await discoverSkills(backendUrl, clean);
    const auto = cands.find((c) => c.auto);
    if (!auto) return empty;
    const full = (await fetchSkill(backendUrl, auto.skillId)) as {
      name?: unknown;
      description?: unknown;
      instructions?: unknown;
    };
    if (typeof full.instructions !== 'string' || !full.instructions) return empty;
    return {
      skillCtx: [
        {
          name: String(full.name || auto.name),
          description: String(full.description || ''),
          instructions: full.instructions.slice(0, 2500),
        },
      ],
      skillSeed: [
        {
          id: uid('tool'),
          tool: 'skill',
          label: `Skill: ${auto.name}`,
          detail: 'Auto-activated for this task',
          state: 'running',
        },
      ],
    };
  } catch {
    return empty; // discovery is best-effort
  }
}
