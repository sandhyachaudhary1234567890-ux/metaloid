// Presence and Pulse — the two engines that make MetaIoid feel continuous.
//
// These are pure functions over real state, so they are tested as such: the
// guarantee under test is that the interface never invents liveness and never
// invents work.

import { describe, it, expect, beforeEach } from 'vitest';
import { derivePresence, greeting } from './presence';
import { AUTONOMY_LEVELS, autonomyToPolicy, allowsAutonomousWork } from '../control';
import { pulseFromMissions, pulseFromTasks, rankPulse, PULSE_LIMIT } from './pulse';
import { TaskCheckpointManager } from '../agent/checkpoint';
import type { TaskCheckpoint } from '../agent/types';

function task(over: Partial<TaskCheckpoint> = {}): TaskCheckpoint {
  return {
    taskId: over.taskId ?? 't1',
    objective: over.objective ?? 'Ship the login flow',
    status: over.status ?? 'EXECUTING',
    currentStepIndex: over.currentStepIndex ?? 0,
    steps: over.steps ?? [
      { id: 's1', type: 'UNDERSTAND', label: 'Understand the request', detail: '', status: 'completed', retries: 0 },
      { id: 's2', type: 'CODE_EDIT', label: 'Apply the fix', detail: '', status: 'pending', retries: 0 },
    ],
    artifacts: over.artifacts ?? [],
    context: over.context ?? { origin: 'chat' },
    telemetry: over.telemetry ?? { resumedCount: 0, errorCount: 0, lastHeartbeat: Date.now() },
    createdAt: over.createdAt ?? Date.now(),
    updatedAt: over.updatedAt ?? Date.now(),
  };
}

describe('presence', () => {
  it('is ready when nothing is happening', () => {
    const p = derivePresence({ status: 'idle' });
    expect(p.state).toBe('ready');
    expect(p.label).toBe('Ready');
    expect(p.live).toBe(false);
  });

  it('follows the agent status while the user waits', () => {
    expect(derivePresence({ status: 'thinking' }).state).toBe('thinking');
    expect(derivePresence({ status: 'executing' }).state).toBe('working');
    expect(derivePresence({ status: 'speaking' }).state).toBe('speaking');
  });

  it('reports listening and speaking from the voice session', () => {
    expect(derivePresence({ status: 'idle', voiceState: 'USER_SPEAKING' }).state).toBe('listening');
    expect(derivePresence({ status: 'idle', voiceState: 'MODEL_SPEAKING' }).state).toBe('speaking');
  });

  it('is working when there is real work in flight, even at rest', () => {
    const p = derivePresence({ status: 'idle', tasks: [task({ status: 'EXECUTING' })] });
    expect(p.state).toBe('working');
    expect(p.live).toBe(true);
  });

  it('is checking when the open task is verifying', () => {
    expect(derivePresence({ status: 'idle', tasks: [task({ status: 'VERIFYING' })] }).state).toBe('verifying');
  });

  it('is ready — not busy — for work that is merely open', () => {
    expect(derivePresence({ status: 'idle', tasks: [task({ status: 'PAUSED' })] }).state).toBe('ready');
  });

  it('greets by the clock', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning.');
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon.');
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening.');
  });
});

describe('pulse', () => {
  beforeEach(() => {
    TaskCheckpointManager['inMemoryStore'].clear();
  });

  it('stays silent when there is nothing worth saying', () => {
    expect(rankPulse(pulseFromTasks([]), pulseFromMissions([]))).toEqual([]);
  });

  it('surfaces unfinished local work with the step that stopped', () => {
    const items = pulseFromTasks([task({ status: 'RECOVERING' })]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('unfinished');
    expect(items[0].body).toContain('Apply the fix');
    expect(items[0].actionLabel).toBe('Continue');
  });

  it('surfaces a failed step ahead of unfinished work', () => {
    const failed = task({
      status: 'RECOVERING',
      steps: [
        { id: 's1', type: 'CODE_EDIT', label: 'Apply the fix', detail: '', status: 'failed', error: 'build broke', retries: 1 },
      ],
    });
    const items = rankPulse(pulseFromTasks([failed]));
    expect(items[0].kind).toBe('failed');
    expect(items[0].body).toContain('build broke');
  });

  it('translates gateway mission states without inventing them', () => {
    const base = { id: 'm1', objective: 'Launch MetaIoid', tasks: [{ status: 'COMPLETED' }, { status: 'PENDING' }] };
    expect(pulseFromMissions([{ ...base, status: 'BLOCKED' }])[0].kind).toBe('blocked');
    expect(pulseFromMissions([{ ...base, status: 'FAILED' }])[0].kind).toBe('failed');
    expect(pulseFromMissions([{ ...base, status: 'PAUSED' }])[0].kind).toBe('unfinished');
    expect(pulseFromMissions([{ ...base, status: 'COMPLETED' }])[0].kind).toBe('completed');
    // A verified mission is history, not a signal.
    expect(pulseFromMissions([{ ...base, status: 'VERIFIED' }])).toEqual([]);
  });

  it('never lets the home screen become a notification tray', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      task({ taskId: `t${i}`, objective: `Task ${i}`, status: 'RECOVERING' }),
    );
    const missions = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`, objective: `Mission ${i}`, status: 'BLOCKED',
      tasks: [{ status: 'PENDING' }],
    }));
    expect(rankPulse(pulseFromTasks(many), pulseFromMissions(missions)).length).toBeLessThanOrEqual(PULSE_LIMIT + 1);
  });

  it('accepts ISO timestamps from the gateway', () => {
    const items = pulseFromMissions([{
      id: 'm1', objective: 'Ship it', status: 'PAUSED',
      tasks: [{ status: 'PENDING' }], createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    expect(items[0].at).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });
});

describe('control', () => {
  it('offers exactly four levels and defaults to assist', () => {
    expect(AUTONOMY_LEVELS.map((l) => l.id)).toEqual(['ask', 'assist', 'approved', 'autopilot']);
    expect(AUTONOMY_LEVELS.every((l) => l.hint.length > 0)).toBe(true);
  });

  it('maps each level onto the policy vocabulary the engine obeys', () => {
    expect(autonomyToPolicy('ask')).toBe('ask_always');
    expect(autonomyToPolicy('assist')).toBe('quiet');
    expect(autonomyToPolicy('approved')).toBe('autonomy_on');
    expect(autonomyToPolicy('autopilot')).toBe('autonomy_on');
  });

  it('treats a pause as "ask first" regardless of the level', () => {
    expect(autonomyToPolicy('autopilot', true)).toBe('ask_always');
    expect(allowsAutonomousWork('autopilot', true)).toBe(false);
    expect(allowsAutonomousWork('autopilot')).toBe(true);
    expect(allowsAutonomousWork('assist')).toBe(false);
  });
});

describe('presence under a hold', () => {
  it('reports paused above every other state', () => {
    const p = derivePresence({ status: 'executing', paused: true });
    expect(p.state).toBe('paused');
    expect(p.label).toBe('Paused');
    expect(p.live).toBe(false);
  });

  it('does not pretend to be busy once resumed with nothing open', () => {
    expect(derivePresence({ status: 'idle', paused: false }).state).toBe('ready');
  });
});
