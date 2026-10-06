import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, CircleDot } from 'lucide-react';
import { useApp } from '../../lib/store';
import { TaskCheckpointManager } from '../../lib/agent/checkpoint';
import { duration, ease } from '../../design/motion';
import { cn } from '../../lib/cn';

/**
 * Local work — the tasks this browser still holds.
 *
 * The gateway owns long-running missions, but work started from a chat turn is
 * checkpointed locally so it survives a reload. Showing it here is what makes
 * "pick up where you left off" true instead of decorative: the row exists, it
 * names the step that stopped, and it hands that step back to the composer.
 *
 * Absent data means absent UI.
 */
export function LocalWork() {
  const { setComposerDraft, setView } = useApp();
  const [tasks, setTasks] = useState(() => TaskCheckpointManager.listInFlightTasks({ includePaused: true }));

  useEffect(() => {
    const refresh = () => setTasks(TaskCheckpointManager.listInFlightTasks({ includePaused: true }));
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  if (tasks.length === 0) return null;

  return (
    <section className="mt-5" aria-label="Unfinished work">
      <div className="label-caps mb-2.5">Unfinished on this device · {tasks.length}</div>

      <div className="space-y-2.5">
        <AnimatePresence initial={false}>
          {tasks.map((task) => {
            const done = task.steps.filter((s) => s.status === 'completed').length;
            const pct = task.steps.length ? Math.round((done / task.steps.length) * 100) : 0;
            const failed = task.steps.find((s) => s.status === 'failed');
            const next = task.steps[task.currentStepIndex];
            const attention = Boolean(failed);

            return (
              <motion.article
                key={task.taskId}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: duration.medium, ease: ease.out }}
                className="surface-interactive flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
              >
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]',
                    attention
                      ? 'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]'
                      : 'bg-[var(--accent-subtle)] text-[var(--accent)]',
                  )}
                >
                  {attention ? <AlertTriangle size={16} strokeWidth={1.8} /> : <CircleDot size={16} strokeWidth={1.8} />}
                </span>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-ui font-medium text-[var(--fg)]">{task.objective}</h3>
                  <p className="mt-0.5 text-small text-[var(--fg-muted)]">
                    {failed
                      ? `Stopped at ${failed.label}${failed.error ? ` — ${failed.error}` : ''}`
                      : next
                        ? `Next: ${next.label}`
                        : 'Ready to finish'}
                    {' · '}
                    <span className="tnum">{pct}%</span>
                  </p>
                </div>

                <button
                  onClick={() => {
                    setComposerDraft(`Continue: ${task.objective}`);
                    setView('chat');
                  }}
                  className="btn-ghost h-9 shrink-0 gap-1.5 px-3.5 text-ui"
                >
                  Continue
                  <ArrowRight size={13} strokeWidth={1.8} />
                </button>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
