// MetaIoid Presence — the continuous state engine.
//
// Presence answers exactly one question in the interface: what is MetaIoid
// doing right now? It is derived from real state and nothing else — the agent
// status, the voice session, and work that is actually in flight.
//
// There is no decorative liveness here. When there is no work the state is
// READY and it stays READY; the interface communicates continuity, not
// theatre. The state vocabulary is deliberately the same one the product
// speaks out loud, so the UI and the voice can never disagree.

import type { AgentStatus } from '../types';
import type { TaskCheckpoint, TaskStatus } from '../agent/types';

export type PresenceState =
  | 'offline'
  | 'paused'
  | 'ready'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'verifying'
  | 'speaking'
  | 'done';

export interface Presence {
  state: PresenceState;
  /** The word shown next to the live indicator. */
  label: string;
  /** A fuller sentence, used where there is room for one. */
  detail: string;
  /** True while the indicator should breathe. */
  live: boolean;
}

/** The vocabulary. Short, calm, and never a subsystem name. */
const COPY: Record<PresenceState, { label: string; detail: string; live: boolean }> = {
  offline: { label: 'Ready', detail: 'Ready · on this device', live: false },
  paused: { label: 'Paused', detail: 'Paused · completed work is saved', live: false },
  ready: { label: 'Ready', detail: 'Ready · listening for you', live: false },
  listening: { label: 'Listening', detail: 'Listening', live: true },
  thinking: { label: 'Thinking', detail: 'Thinking', live: true },
  working: { label: 'Working', detail: 'Working on your task', live: true },
  verifying: { label: 'Checking', detail: 'Checking the result', live: true },
  speaking: { label: 'Speaking', detail: 'Speaking', live: true },
  done: { label: 'Done', detail: 'Done', live: false },
};

/** The statuses that mean MetaIoid has work open right now. */
const BUSY: TaskStatus[] = ['ANALYZING', 'PLANNING', 'EXECUTING', 'VERIFYING', 'RECOVERING'];
/** Recovered from a previous session: open, but nobody is driving it. */
const OPEN: TaskStatus[] = ['PAUSED', 'QUEUED'];

export interface PresenceInput {
  /** Agent status from the session store. */
  status: AgentStatus;
  /** True while the user has told MetaIoid to hold. */
  paused?: boolean;
  /** Live voice session state, when the voice surface is open. */
  voiceState?: string | null;
  /** Work MetaIoid currently has open. */
  tasks?: TaskCheckpoint[];
  /** True when a gateway is connected — used only for the offline wording. */
  connected?: boolean;
}

/**
 * Pure derivation, so the mapping is testable without React.
 *
 * Precedence is deliberate: what the user is doing right now (listening,
 * speaking) outranks background work, which outranks the resting state.
 */
export function derivePresence(input: PresenceInput): Presence {
  const { status, voiceState, tasks = [], connected = true, paused = false } = input;

  let state: PresenceState;

  // A hold outranks everything else: the user must always be able to see that
  // MetaIoid is not working, and why.
  if (paused) {
    state = 'paused';
  } else if (voiceState === 'LISTENING' || voiceState === 'USER_SPEAKING' || voiceState === 'TURN_CANDIDATE' || voiceState === 'USER_INTERRUPT') {
    state = 'listening';
  } else if (voiceState === 'MODEL_SPEAKING') {
    state = 'speaking';
  } else if (voiceState === 'PROCESSING' || voiceState === 'CANCELLING' || voiceState === 'RECOVERING') {
    state = 'thinking';
  } else if (status === 'listening') {
    state = 'listening';
  } else if (status === 'speaking') {
    state = 'speaking';
  } else if (status === 'vision') {
    state = 'listening';
  } else if (status === 'error') {
    state = 'ready';
  } else if (tasks.some((t) => t.status === 'VERIFYING')) {
    // Checking is a distinct state the user should be able to see coming: it
    // is the difference between "still going" and "about to answer".
    state = 'verifying';
  } else if (status === 'executing' || tasks.some((t) => BUSY.includes(t.status))) {
    state = 'working';
  } else if (status === 'thinking') {
    state = 'thinking';
  } else if (tasks.some((t) => OPEN.includes(t.status))) {
    state = 'ready';
  } else {
    state = connected ? 'ready' : 'offline';
  }

  const copy = COPY[state];
  return { state, label: copy.label, detail: copy.detail, live: copy.live };
}

/** Greeting for the home composition. Time of day, nothing more clever. */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}
