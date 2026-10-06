import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Rocket, Pause, Play, Square, CheckCircle2, Plus } from 'lucide-react';
import { useApp } from '../lib/store';
import {
  missionCreate, agentMission, missionRun, missionGet, missionList,
  missionPause, missionCancel, type Mission,
} from '../lib/transport';
import { cn } from '../lib/cn';

// Mission Control — slide-over for the agent runtime (§4–5).
// Missions persist server-side; "continue" resumes from checkpoint.
// Not a primary nav item: opened from chat intents, drawer, palette.

const STATUS_STYLE: Record<string, string> = {
  QUEUED: 'text-[var(--fg-muted)] border-[var(--border)] bg-[var(--surface-sunken)]',
  RUNNING: 'text-[var(--accent)] border-info/25 bg-info/5',
  PAUSED: 'text-warning border-warning/25 bg-warning/5',
  BLOCKED: 'text-warning border-warning/25 bg-warning/5',
  FAILED: 'text-danger border-danger/25 bg-danger/5',
  COMPLETED: 'text-success border-success/25 bg-success/5',
  VERIFIED: 'text-success border-success/40 bg-success/10',
};

export function MissionsPanel({ open, onClose, initialObjective = '' }: {
  open: boolean; onClose: () => void; initialObjective?: string;
}) {
  const { settings, toast, connection } = useApp();
  const base = settings.backendUrl;
  const online = connection === 'online';
  const [missions, setMissions] = useState<Mission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);
  const active: Mission | null = missions.find((m) => m.id === activeId) ?? missions[0] ?? null;

  const refresh = useCallback(async (id?: string) => {
    try {
      if (id) {
        const m = await missionGet(base, id);
        setMissions((p) => p.map((x) => (x.id === id ? m : x)));
      } else {
        setMissions(await missionList(base));
      }
    } catch { /* gateway down — panel shows empty, honest */ }
  }, [base]);

  useEffect(() => {
    if (open) {
      if (initialObjective) setDraft(initialObjective);
      refresh();
      pollRef.current = window.setInterval(() => {
        setMissions((prev) => {
          const live = prev.some((m) => m.status === 'RUNNING');
          if (live) refresh();
          return prev;
        });
      }, 2000);
    } else {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, initialObjective, refresh]);

  const launch = async (withAgent: boolean) => {
    const objective = draft.trim();
    if (!objective) {
      toast({ title: 'Describe the mission first' });
      return;
    }
    if (!online) {
      toast({ title: 'Gateway offline', desc: 'Missions need the backend. Check Settings → System.' });
      return;
    }
    setBusy(true);
    try {
      const m = withAgent ? await agentMission(base, objective) : await missionCreate(base, objective);
      setDraft('');
      await refresh();
      setActiveId(m.id);
      if (!withAgent) {
        await missionRun(base, m.id);
        await refresh(m.id);
      }
      toast({ title: withAgent ? 'Mission running with synthesis' : 'Mission started' });
    } catch (e) {
      toast({ title: 'Mission failed to start', desc: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: (b: string, id: string) => Promise<unknown>, id: string, label: string) => {
    try {
      await fn(base, id);
      await refresh(id);
    } catch (e) {
      toast({ title: label, desc: e instanceof Error ? e.message : '' });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[75] bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed top-0 right-0 bottom-0 z-[76] w-full sm:w-[540px] border-l border-[var(--border)] bg-[var(--surface)] flex flex-col"
            role="dialog" aria-label="Mission control"
          >
            <div className="px-6 pt-5 pb-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-[var(--radius-lg)] bg-[var(--accent-subtle)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] flex items-center justify-center">
                  <Rocket size={18} className="text-[var(--accent)]" />
                </span>
                <div className="flex-1">
                  <h3 className="t-title">Mission Control</h3>
                  <p className="text-small text-[var(--fg-muted)]">Plan → execute → verify · resumable</p>
                </div>
                <button onClick={onClose} className="icon-btn w-9 h-9" aria-label="Close missions"><X size={17} /></button>
              </div>
              <div className="mt-4 flex gap-2">
                <input
                  value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') launch(true); }}
                  placeholder="Mission objective — e.g. Profile example.com footprint"
                  className="flex-1 h-12 rounded-[var(--radius-lg)] bg-[var(--surface-sunken)] border border-[var(--border)] px-4 text-body outline-none focus:border-[var(--accent)] placeholder:text-[var(--fg-subtle)] min-w-0"
                  aria-label="Mission objective"
                />
                <button onClick={() => launch(true)} disabled={busy} className="btn-primary h-12 px-4 text-ui shrink-0 disabled:opacity-50 min-w-[44px]" title="Run with model synthesis">
                  <Plus size={15} /> Run
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
              {missions.length === 0 && (
                <div className="py-10 text-center">
                  <p className="text-body text-[var(--fg-secondary)]">No missions yet.</p>
                  <p className="text-ui text-[var(--fg-subtle)] mt-1">Say “mission: …” in chat, or describe one above. “Continue” resumes.</p>
                </div>
              )}
              {missions.map((m) => {
                const expanded = active?.id === m.id;
                const done = m.tasks.filter((t) => t.status === 'COMPLETED').length;
                return (
                  <div key={m.id} className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-sunken)] overflow-hidden">
                    <button onClick={() => setActiveId(expanded ? null : m.id)} className="w-full flex items-center gap-3 p-4 text-left min-h-[56px]">
                      <span className={cn('text-micro font-semibold tracking-[0.1em] rounded-full px-2.5 py-1 border shrink-0', STATUS_STYLE[m.status] ?? STATUS_STYLE.QUEUED)}>
                        {m.status}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-body font-semibold truncate">{m.objective}</span>
                        <span className="block text-small text-[var(--fg-muted)]">{done}/{m.tasks.length} tasks{expanded ? '' : ` · ${new Date(m.createdAt).toLocaleString()}`}</span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="px-4 pb-4">
                        <div className="h-1 rounded-full bg-[var(--surface-active)] overflow-hidden mb-3">
                          <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${m.tasks.length ? (done / m.tasks.length) * 100 : 0}%` }} />
                        </div>
                        <div className="space-y-1.5">
                          {m.tasks.map((t) => (
                            <div key={t.id} className="flex items-center gap-2.5 text-ui">
                              <TaskDot status={t.status} />
                              <span className="flex-1 min-w-0 truncate text-[var(--fg-secondary)]">{t.name}</span>
                              {t.tool && <span className="font-mono text-micro text-[var(--fg-subtle)] shrink-0">{t.tool}</span>}
                              {t.error && <span className="text-micro text-danger truncate max-w-[180px]" title={t.error}>{t.error}</span>}
                            </div>
                          ))}
                        </div>
                        {m.outputs?.report && (
                          <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3.5 text-ui leading-relaxed text-[var(--fg-secondary)] whitespace-pre-wrap max-h-[220px] overflow-y-auto">
                            {m.outputs.report}
                          </div>
                        )}
                        {m.errors.length > 0 && (
                          <p className="mt-2 text-small text-warning/90">{m.errors.length} noted error(s) — see timeline in debug.</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {(m.status === 'QUEUED' || m.status === 'PAUSED' || m.status === 'BLOCKED') && (
                            <PanelBtn icon={Play} label="Run / resume" onClick={() => act(missionRun, m.id, 'Resume failed')} />
                          )}
                          {m.status === 'RUNNING' && (
                            <>
                              <PanelBtn icon={Pause} label="Pause" onClick={() => act(missionPause, m.id, 'Pause failed')} />
                              <PanelBtn icon={Square} label="Stop" onClick={() => act(missionCancel, m.id, 'Stop failed')} />
                            </>
                          )}
                          {m.status === 'COMPLETED' && (
                            <span className="inline-flex items-center gap-1.5 text-small text-success"><CheckCircle2 size={13} /> Awaiting verification</span>
                          )}
                          {m.status === 'VERIFIED' && (
                            <span className="inline-flex items-center gap-1.5 text-small text-success"><CheckCircle2 size={13} /> Verified outcome</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function TaskDot({ status }: { status: string }) {
  return (
    <span className={cn('w-2 h-2 rounded-full shrink-0',
      status === 'COMPLETED' ? 'bg-[var(--success)]' : status === 'RUNNING' ? 'bg-[var(--accent)] animate-pulse-soft'
      : status === 'FAILED' ? 'bg-[var(--danger)]' : status === 'BLOCKED' ? 'bg-[var(--warning)]' : 'bg-[var(--fg-subtle)]')} />
  );
}

function PanelBtn({ icon: Icon, label, onClick }: { icon: typeof Play; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-ghost h-9 px-3.5 text-small">
      <Icon size={13} /> {label}
    </button>
  );
}
