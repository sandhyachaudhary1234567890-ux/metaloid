// MetaIoid control — the three levels of autonomy, in one place.
//
// The user is always in charge, and the product says so out loud rather than
// burying it. These four levels map onto the initiative policy's own
// vocabulary, so the setting the user picks is the setting the engine obeys —
// there is no second, hidden notion of "how autonomous" MetaIoid is.

import type { UserAutonomyPreference } from './agent/initiativePolicy';

export type AutonomyLevel = 'ask' | 'assist' | 'approved' | 'autopilot';

export interface AutonomyOption {
  id: AutonomyLevel;
  label: string;
  /** One sentence, in the product's voice. */
  hint: string;
}

export const AUTONOMY_LEVELS: AutonomyOption[] = [
  {
    id: 'ask',
    label: 'Ask first',
    hint: 'MetaIoid proposes; nothing happens until you say so.',
  },
  {
    id: 'assist',
    label: 'Assist',
    hint: 'MetaIoid prepares the next step and waits for your go-ahead.',
  },
  {
    id: 'approved',
    label: 'Execute approved',
    hint: 'Acts inside the permissions you have already granted.',
  },
  {
    id: 'autopilot',
    label: 'Autopilot',
    hint: 'Continues approved missions while you are away, and reports back.',
  },
];

export const DEFAULT_AUTONOMY: AutonomyLevel = 'assist';

export function autonomyOption(id: AutonomyLevel): AutonomyOption {
  return AUTONOMY_LEVELS.find((l) => l.id === id) ?? AUTONOMY_LEVELS[1];
}

/**
 * Translate the user's chosen level into the initiative policy's preference.
 *
 * A paused MetaIoid behaves like "ask first" regardless of the level: pausing
 * means hold everything, and the policy must not be able to override that.
 */
export function autonomyToPolicy(level: AutonomyLevel, paused = false): UserAutonomyPreference {
  if (paused) return 'ask_always';
  switch (level) {
    case 'ask':
      return 'ask_always';
    case 'assist':
      return 'quiet';
    default:
      return 'autonomy_on';
  }
}

/** True when the level allows MetaIoid to keep working without being asked. */
export function allowsAutonomousWork(level: AutonomyLevel, paused = false): boolean {
  return !paused && (level === 'approved' || level === 'autopilot');
}
