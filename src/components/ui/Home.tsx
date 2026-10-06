import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, CircleDot, Lightbulb, Loader2, Pause, Play, Target } from 'lucide-react';
import { useApp } from '../../lib/store';
import { TaskCheckpointManager } from '../../lib/agent/checkpoint';
import { missionList, missionRun, type Mission } from '../../lib/transport';
import { derivePresence, greeting } from '../../lib/ready/presence';
import {
  pulseFromMissions, pulseFromTasks, rankPulse,
  type PulseItem,
} from '../../lib/ready/pulse';
import { cn } from '../../lib/cn';
import { duration, ease } from '../../design/motion';

/**
 * MetaIoid Home — the surface that says "I'm here, and here's where things
 * stand" before the user has asked anything.
 *
 * Four parts, in order of how loudly they speak:
 *
 *   1. Presence   one dot, one word. Never a dashboard header.
 *   2. Mission    the one long-running thing, with real progress.
 *   3. Continue   the most relevant open thing, if there is one.
 *   4. Pulse      at most a couple more things that genuinely matter.
 *
 * Everything here is derived from real state. When there is nothing worth
 * saying, parts 2–4 render nothing at all — the home screen is allowed to be
 * quiet, and a quiet home screen is the point.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   Shared reads
   ───────────────────────────────────────────────────────────────────────────── */

/** Local checkpoints this browser still holds: unfinished work. */
export function useOpenTasks() {
  const [tasks, setTasks] = useState(() => TaskCheckpointManager.listInFlightTasks({ includePaused: true }));

  useEffect(() => {
    // A tab that closed mid-task leaves work behind. Adopting it once on boot
    // is what makes "we stopped here" true rather than decorative.
    TaskCheckpointManager.recoverPendingTasks();
    const refresh = () => setTasks(TaskCheckpointManager.listInFlightTasks({ includePaused: true }));
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  return tasks;
}

/** Gateway missions. Empty — and silent — when no gateway is connected. */
export function useMissions(): Mission[] {
  const { settings, connection } = useApp();
  const online = connection === 'online';
  const [missions, setMissions] = useState<Mission[]>([]);

  useEffect(() => {
    if (!online) {
      setMissions([]);
      return;
    }
    let alive = true;
    missionList(settings.backendUrl)
      .then((list) => { if (alive) setMissions(list ?? []); })
      .catch(() => { if (alive) setMissions([]); });
    return () => { alive = false; };
  }, [online, settings.backendUrl]);

  return missions;
}

/* ─────────────────────────────────────────────────────────────────────────────
   1 · Presence
   ───────────────────────────────────────────────────────────────────────────── */

export function PresenceLine() {
  const { status, voiceOpen, connection, settings } = useApp();
  const tasks = useOpenTasks();
  const presence = derivePresence({
    status,
    voiceState: voiceOpen ? 'LISTENING' : null,
    tasks,
    connected: connection === 'online',
    paused: settings.paused,
  });

  return (
    <div className="flex items-center justify-center gap-2.5" role="status" aria-live="polite">
      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden>
        {presence.live && (
          <motion.span
            className="absolute inset-0 rounded-full bg-[var(--accent)]"
            animate={{ opacity: [0.35, 0, 0.35], scale: [1, 2.1, 1] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <span
          className={cn(
            'relative h-1.5 w-1.5 rounded-full',
            presence.state === 'paused' ? 'bg-[var(--fg-subtle)]' : 'bg-[var(--accent)]',
            presence.live && 'animate-pulse-soft',
          )}
        />
      </span>

      <span className="text-micro text-[var(--fg-muted)]">MetaIoid · Live</span>

      <span className="h-3 w-px bg-[var(--border)]" aria-hidden />

      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={presence.state}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: duration.micro, ease: ease.out }}
          className="text-small text-[var(--fg-secondary)]"
        >
          {presence.label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** The greeting line. One sentence, and it changes with the clock. */
export function HomeGreeting({ name }: { name?: string | null }) {
  const hello = useMemo(() => greeting(), []);
  return (
    <h1 className="t-hero text-balance text-[var(--fg)]">
      {hello}
      {name ? ` ${name}.` : ''}
    </h1>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   2 · Active mission
   ───────────────────────────────────────────────────────────────────────────── */

const LIVE_MISSION = ['RUNNING', 'PAUSED', 'BLOCKED', 'QUEUED', 'COMPLETED'];

export function ActiveMission({ className }: { className?: string }) {
  const { setMissionsOpen, setMissionDraft } = useApp();
  const missions = useMissions();
  const mission = missions.find((m) => LIVE_MISSION.includes(m.status)) ?? null;

  if (!mission) return null;

  const done = mission.tasks.filter((t) => t.status === 'COMPLETED').length;
  const total = mission.tasks.length || 1;
  const pct = Math.round((done / total) * 100);
  const next = mission.tasks.find((t) => t.status !== 'COMPLETED');

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.medium, ease: ease.out, delay: 0.1 }}
      onClick={() => { setMissionDraft(''); setMissionsOpen(true); }}
      className={cn(
        'group flex w-full flex-col gap-2.5 rounded-[var(--radius-lg)] border border-[var(--border)]',
        'bg-[var(--surface)] px-4 py-3.5 text-left transition-colors duration-small ease-out',
        'hover:border-[var(--border-strong)]',
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <Target size={14} strokeWidth={1.8} className="shrink-0 text-[var(--accent)]" />
        <span className="text-micro font-semibold text-[var(--fg-muted)]">Active mission</span>
        <span className="ml-auto flex items-center gap-1.5 text-small text-[var(--fg-muted)]">
          <Play size={10} className="transition-transform duration-medium ease-out group-hover:translate-x-0.5" />
          {pct}%
        </span>
      </span>

      <span className="block truncate text-read font-semibold text-[var(--fg)]">{mission.objective}</span>

      <span className="block h-1 overflow-hidden rounded-full bg-[var(--surface-active)]">
        <motion.span
          className="block h-full rounded-full bg-[var(--accent)]"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: duration.large, ease: ease.out }}
        />
      </span>

      {next && (
        <span className="block truncate text-small text-[var(--fg-muted)]">
          <span className="text-[var(--fg-subtle)]">Next</span> · {next.name}
        </span>
      )}
    </motion.button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   3 + 4 · Continue and Pulse
   ───────────────────────────────────────────────────────────────────────────── */

export function HomeSignals({ className }: { className?: string }) {
  const { settings, setView, setMissionsOpen, setMissionDraft, setComposerDraft, resumeMetaIoid, toast } = useApp();
  const tasks = useOpenTasks();
  const missions = useMissions();

  const items = useMemo(
    () => rankPulse(pulseFromTasks(tasks), pulseFromMissions(missions)),
    [tasks, missions],
  );

  // A hold is the one thing that outranks every signal: the user has to be
  // able to see it and undo it without hunting through settings.
  if (settings.paused) {
    return (
      <div className={cn('flex w-full flex-col gap-2', className)}>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.medium, ease: ease.out, delay: 0.1 }}
          className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-left"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-active)] text-[var(--fg-muted)]">
            <Pause size={13} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-micro font-semibold text-[var(--fg-muted)]">Paused</span>
            <span className="mt-0.5 block text-ui text-[var(--fg)]">
              Everything in flight is held. Completed work is saved.
            </span>
          </span>
          <button onClick={resumeMetaIoid} className="btn-ghost h-8 shrink-0 gap-1 px-3 text-small">
            Resume
            <Play size={11} />
          </button>
        </motion.div>
      </div>
    );
  }

  if (items.length === 0) return null;

  const run = (item: PulseItem) => {
    switch (item.action.kind) {
      case 'open-tasks':
        setView('tasks');
        break;
      case 'open-mission':
        setMissionDraft('');
        setMissionsOpen(true);
        break;
      case 'resume-mission':
        setMissionDraft('');
        setMissionsOpen(true);
        void missionRun(settings.backendUrl, item.action.missionId).catch(() =>
          toast({ title: 'Could not resume that task', tone: 'error' }),
        );
        break;
      case 'continue-chat':
        setComposerDraft(item.action.prompt);
        setView('chat');
        break;
      default:
        setView('settings');
    }
  };

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      {items.map((item, i) => (
        <SignalRow key={item.id} item={item} delay={0.14 + i * 0.05} onRun={() => run(item)} />
      ))}
    </div>
  );
}

const KIND_ICON = {
  unfinished: CircleDot,
  failed: Lightbulb,
  blocked: Lightbulb,
  running: Loader2,
  completed: Check,
} as const;

function SignalRow({ item, delay, onRun }: { item: PulseItem; delay: number; onRun: () => void }) {
  const Icon = KIND_ICON[item.kind] ?? CircleDot;
  const attention = item.kind === 'failed' || item.kind === 'blocked';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.medium, ease: ease.out, delay }}
      className="group flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-left transition-colors duration-small ease-out hover:border-[var(--border-strong)]"
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          attention
            ? 'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]'
            : 'bg-[var(--accent-subtle)] text-[var(--accent)]',
        )}
      >
        <Icon size={14} strokeWidth={1.8} className={item.kind === 'running' ? 'animate-spin' : undefined} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-micro font-semibold text-[var(--fg-muted)]">{item.label}</span>
        <span className="mt-0.5 block text-ui text-[var(--fg)] text-pretty">{item.body}</span>
      </span>

      <button onClick={onRun} className="btn-ghost h-8 shrink-0 gap-1 px-3 text-small">
        {item.actionLabel}
        <ArrowRight size={12} className="transition-transform duration-medium ease-out group-hover:translate-x-0.5" />
      </button>
    </motion.div>
  );
}

/**
 * Backwards-compatible name for the welcome composition's proactive stack.
 */
export { HomeSignals as Proactive };
