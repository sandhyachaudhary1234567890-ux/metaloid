import { useEffect, useState } from 'react';

// ActivityStateEngine — event-driven live activity. Stages appear ONLY when
// real runtime events arrive (no fake timers, no invented progress, no
// chain-of-thought). One engine, task-scoped subscriptions, batched notify.

export type ActivityPhase =
  | 'UNDERSTAND'
  | 'PLAN'
  | 'RETRIEVE'
  | 'EXECUTE'
  | 'CHECK'
  | 'REPAIR'
  | 'FINALIZE';

export type ActivityStatus = 'running' | 'done' | 'error';

export interface ActivityEvent {
  taskId: string;
  timestamp: number;
  phase: ActivityPhase;
  status: ActivityStatus;
  label: string;
  detail?: string;
  toolId?: string;
  artifactId?: string;
}

export type TaskKind = 'chat' | 'research' | 'artifact' | 'presentation' | 'document' | 'spreadsheet' | 'skill' | 'image' | 'mission' | 'voice' | 'code';

const PHASE_ORDER: ActivityPhase[] = ['UNDERSTAND', 'PLAN', 'RETRIEVE', 'EXECUTE', 'CHECK', 'REPAIR', 'FINALIZE'];

// Stage templates: ORDER + fallback labels per kind. A stage renders only
// after its first event; templates never invent events.
const TEMPLATES: Record<TaskKind, Partial<Record<ActivityPhase, string>>> = {
  chat: { UNDERSTAND: 'Understanding request', RETRIEVE: 'Checking context', EXECUTE: 'Answering', CHECK: 'Verifying' },
  research: { UNDERSTAND: 'Understanding question', RETRIEVE: 'Searching sources', EXECUTE: 'Comparing information', PLAN: 'Synthesizing findings', CHECK: 'Checking sources', FINALIZE: 'Preparing answer' },
  artifact: { UNDERSTAND: 'Understanding request', PLAN: 'Planning structure', RETRIEVE: 'Gathering content', EXECUTE: 'Building file', CHECK: 'Validating', REPAIR: 'Fixing issues', FINALIZE: 'Final verification' },
  presentation: { UNDERSTAND: 'Understanding topic', PLAN: 'Planning slides', RETRIEVE: 'Gathering content', EXECUTE: 'Creating slides', CHECK: 'Validating PowerPoint', REPAIR: 'Fixing layout', FINALIZE: 'Verifying final file' },
  document: { UNDERSTAND: 'Understanding topic', PLAN: 'Planning structure', RETRIEVE: 'Gathering content', EXECUTE: 'Writing document', CHECK: 'Validating document', FINALIZE: 'Verifying final file' },
  spreadsheet: { UNDERSTAND: 'Understanding data model', PLAN: 'Structuring columns', RETRIEVE: 'Gathering metrics', EXECUTE: 'Computing table', CHECK: 'Validating formulas', FINALIZE: 'Verifying final file' },
  skill: { UNDERSTAND: 'Understanding request', PLAN: 'Selecting skill', EXECUTE: 'Running skill', CHECK: 'Verifying result' },
  image: { UNDERSTAND: 'Understanding prompt', PLAN: 'Preparing generation', EXECUTE: 'Generating', CHECK: 'Inspecting result', FINALIZE: 'Finalizing' },
  mission: { UNDERSTAND: 'Understanding objective', PLAN: 'Planning tasks', EXECUTE: 'Running tasks', CHECK: 'Verifying outcomes', FINALIZE: 'Finalizing' },
  voice: { UNDERSTAND: 'Listening', RETRIEVE: 'Checking context', EXECUTE: 'Answering', FINALIZE: 'Speaking' },
  code: { UNDERSTAND: 'Understanding repository', RETRIEVE: 'Finding relevant code', PLAN: 'Planning change', EXECUTE: 'Editing files', CHECK: 'Running tests', FINALIZE: 'Verifying result' },
};

interface TaskState {
  kind: TaskKind;
  events: ActivityEvent[];
  startedAt: number;
  ended: boolean;
}

const tasks = new Map<string, TaskState>();
const listeners = new Map<string, Set<() => void>>();
let flushQueued = false;
const dirty = new Set<string>();

function notify(taskId: string) {
  dirty.add(taskId);
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    for (const id of dirty) {
      listeners.get(id)?.forEach((fn) => {
        try {
          fn();
        } catch { /* ignore */ }
      });
    }
    dirty.clear();
  });
}

export function startTask(taskId: string, kind: TaskKind): void {
  if (!tasks.has(taskId)) {
    tasks.set(taskId, { kind, events: [], startedAt: Date.now(), ended: false });
    if (tasks.size > 20) {
      const first = tasks.keys().next().value;
      if (first) {
        tasks.delete(first);
        listeners.delete(first);
      }
    }
  }
  notify(taskId);
}

export function emitActivity(
  taskId: string,
  kind: TaskKind,
  phase: ActivityPhase,
  status: ActivityStatus,
  label: string,
  detail = '',
  extra: { toolId?: string; artifactId?: string } = {}
): void {
  let t = tasks.get(taskId);
  if (!t) {
    startTask(taskId, kind);
    t = tasks.get(taskId)!;
  }
  t.events.push({ taskId, timestamp: Date.now(), phase, status, label, detail, ...extra });
  if (t.events.length > 100) t.events.splice(0, t.events.length - 100);
  if (status === 'error' || (phase === 'FINALIZE' && status === 'done')) t.ended = true;
  notify(taskId);
}

export function endTask(taskId: string): void {
  tasks.delete(taskId);
  listeners.delete(taskId);
}

/** Re-classify a task mid-flight (e.g. chat → presentation once intent is known). */
export function renameTask(taskId: string, kind: TaskKind): void {
  const t = tasks.get(taskId);
  if (!t) return;
  t.kind = kind;
  notify(taskId);
}

// ---------- presentation layer ----------
// REAL AGENT EVENTS → ActivityStateMapper → ONE-LINE UI.
// Internal phases stay internal; the UI maps them to a small human set.
// The collapsed line updates ONLY on real state changes (kind/error/done).

export type SimpleState = 'THINKING' | 'WORKING' | 'CREATING' | 'SEARCHING' | 'CHECKING' | 'DONE' | 'ERROR';

const KIND_LINE: Record<TaskKind, { state: SimpleState; label: string }> = {
  chat: { state: 'THINKING', label: 'Thinking…' },
  research: { state: 'SEARCHING', label: 'Researching…' },
  artifact: { state: 'CREATING', label: 'Creating…' },
  presentation: { state: 'CREATING', label: 'Creating your presentation…' },
  document: { state: 'CREATING', label: 'Creating your document…' },
  spreadsheet: { state: 'CREATING', label: 'Building your spreadsheet…' },
  skill: { state: 'WORKING', label: 'Working…' },
  image: { state: 'CREATING', label: 'Creating image…' },
  mission: { state: 'WORKING', label: 'Working…' },
  voice: { state: 'THINKING', label: 'Listening…' },
  code: { state: 'WORKING', label: 'Working on your code…' },
};

export interface SimpleView {
  state: SimpleState;
  label: string;
  lines: { label: string; detail: string; status: ActivityStatus }[];
  ended: boolean;
}

/** One-line view + compact safe summary. Never chain-of-thought. */
export function simpleViewOf(taskId: string): SimpleView | null {
  const t = tasks.get(taskId);
  if (!t) return null;
  const failed = t.events.some((e) => e.status === 'error');
  const done = t.ended && !failed;
  if (failed) {
    const err = [...t.events].reverse().find((e) => e.status === 'error');
    return {
      state: 'ERROR',
      label: 'Couldn’t complete this task',
      lines: err ? [{ label: err.label, detail: err.detail || '', status: 'error' }] : [],
      ended: true,
    };
  }
  if (done) {
    return { state: 'DONE', label: 'Done', lines: [], ended: true };
  }
  const base = KIND_LINE[t.kind] || KIND_LINE.chat;
  // Compact high-level summary: arrived stage labels only (curated, safe).
  const seen = new Map<ActivityPhase, ActivityEvent>();
  for (const e of t.events) {
    if (!seen.has(e.phase) || e.status !== 'running') seen.set(e.phase, e);
  }
  const lines = PHASE_ORDER.filter((p) => seen.has(p)).map((p) => {
    const e = seen.get(p)!;
    return { label: e.label, detail: e.detail || '', status: e.status };
  });
  return { state: base.state, label: base.label, lines, ended: false };
}

export interface StageView {
  phase: ActivityPhase;
  label: string;
  detail: string;
  status: ActivityStatus;
  startedAt: number;
}

/** Ordered stage checklist derived from REAL events only. */
export function stagesOf(taskId: string): { kind: TaskKind; stages: StageView[]; ended: boolean; startedAt: number } | null {
  const t = tasks.get(taskId);
  if (!t) return null;
  const tpl = TEMPLATES[t.kind] || TEMPLATES.chat;
  const byPhase = new Map<ActivityPhase, ActivityEvent[]>();
  for (const e of t.events) {
    if (!byPhase.has(e.phase)) byPhase.set(e.phase, []);
    byPhase.get(e.phase)!.push(e);
  }
  const stages: StageView[] = [];
  for (const phase of PHASE_ORDER) {
    const evs = byPhase.get(phase);
    if (!evs || !evs.length) continue; // never invent a stage
    const last = evs[evs.length - 1];
    stages.push({
      phase,
      label: last.label || tpl[phase] || phase,
      detail: last.detail || '',
      status: last.status,
      startedAt: evs[0].timestamp,
    });
  }
  return { kind: t.kind, stages, ended: t.ended, startedAt: t.startedAt };
}

export function useTaskActivity(taskId: string | null) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!taskId) return;
    let set = listeners.get(taskId);
    if (!set) {
      set = new Set();
      listeners.set(taskId, set);
    }
    const fn = () => bump((n) => n + 1);
    set.add(fn);
    return () => {
      listeners.get(taskId)?.delete(fn);
    };
  }, [taskId]);
  if (!taskId) return null;
  return stagesOf(taskId);
}

export function taskElapsed(taskId: string): number {
  const t = tasks.get(taskId);
  if (!t) return 0;
  const last = t.events[t.events.length - 1];
  return (last ? last.timestamp : Date.now()) - t.startedAt;
}

// Awaited-side helper: the UI Stop button only knows the session's
// liveTaskId; flows register themselves here so stop marks THAT task.
let currentTaskId: string | null = null;
export function setCurrentTask(taskId: string | null): void {
  currentTaskId = taskId;
}
export function stopCurrentTask(reason = 'Stopped by user'): void {
  if (!currentTaskId) return;
  const t = tasks.get(currentTaskId);
  if (t && !t.ended) {
    emitActivity(currentTaskId, t.kind, 'FINALIZE', 'error', reason);
  }
}
