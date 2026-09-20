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
  QUEUED: 'text-zinc-400 border-white/10 bg-white/[0.03]',
  RUNNING: 'text-cyan-200 border-cyan-200/25 bg-cyan-300/[0.06]',
  PAUSED: 'text-amber-300 border-amber-400/25 bg-amber-400/[0.06]',
  BLOCKED: 'text-amber-300 border-amber-400/25 bg-amber-400/[0.06]',
  FAILED: 'text-red-300 border-red-500/25 bg-red-500/[0.06]',
  COMPLETED: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/[0.06]',
  VERIFIED: 'text-emerald-200 border-emerald-300/40 bg-emerald-400/[0.10]',
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
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-[76] w-full sm:w-[540px] border-l border-white/10 bg-ink-850 flex flex-col"
            role="dialog" aria-label="Mission control"
          >
            <div className="px-6 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-2xl bg-violet-400/10 border border-violet-300/25 flex items-center justify-center">
                  <Rocket size={18} className="text-violet-200" />
                </span>
                <div className="flex-1">
                  <h3 className="text-[17px] font-bold tracking-tight">Mission Control</h3>
                  <p className="text-[12px] text-zinc-500">Plan → execute → verify · resumable</p>
                </div>
                <button onClick={onClose} className="icon-btn w-9 h-9" aria-label="Close missions"><X size={17} /></button>
              </div>
              <div className="mt-4 flex gap-2">
                <input
                  value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') launch(true); }}
                  placeholder="Mission objective — e.g. Profile example.com footprint"
                  className="flex-1 h-12 rounded-2xl bg-white/[0.04] border border-white/10 px-4 text-[14px] outline-none focus:border-violet-300/50 placeholder:text-zinc-600 min-w-0"
                  aria-label="Mission objective"
                />
                <button onClick={() => launch(true)} disabled={busy} className="btn-primary h-12 px-4 text-[13.5px] shrink-0 disabled:opacity-50 min-w-[44px]" title="Run with model synthesis">
                  <Plus size={15} /> Run
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
              {missions.length === 0 && (
                <div className="py-10 text-center">
                  <p className="text-[14.5px] text-zinc-300">No missions yet.</p>
                  <p className="text-[13px] text-zinc-600 mt-1">Say “mission: …” in chat, or describe one above. “Continue” resumes.</p>
                </div>
              )}
              {missions.map((m) => {
                const expanded = active?.id === m.id;
                const done = m.tasks.filter((t) => t.status === 'COMPLETED').length;
                return (
                  <div key={m.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                    <button onClick={() => setActiveId(expanded ? null : m.id)} className="w-full flex items-center gap-3 p-4 text-left min-h-[56px]">
                      <span className={cn('text-[10.5px] font-bold tracking-[0.1em] rounded-full px-2.5 py-1 border shrink-0', STATUS_STYLE[m.status] ?? STATUS_STYLE.QUEUED)}>
                        {m.status}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-semibold truncate">{m.objective}</span>
                        <span className="block text-[12px] text-zinc-500">{done}/{m.tasks.length} tasks{expanded ? '' : ` · ${new Date(m.createdAt).toLocaleString()}`}</span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="px-4 pb-4">
                        <div className="h-1 rounded-full bg-white/10 overflow-hidden mb-3">
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-300 to-cyan-200 transition-all" style={{ width: `${m.tasks.length ? (done / m.tasks.length) * 100 : 0}%` }} />
                        </div>
                        <div className="space-y-1.5">
                          {m.tasks.map((t) => (
                            <div key={t.id} className="flex items-center gap-2.5 text-[13px]">
                              <TaskDot status={t.status} />
                              <span className="flex-1 min-w-0 truncate text-zinc-300">{t.name}</span>
                              {t.tool && <span className="font-mono text-[11px] text-zinc-600 shrink-0">{t.tool}</span>}
                              {t.error && <span className="text-[11.5px] text-red-300 truncate max-w-[180px]" title={t.error}>{t.error}</span>}
                            </div>
                          ))}
                        </div>
                        {m.outputs?.report && (
                          <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 text-[13px] leading-relaxed text-zinc-300 whitespace-pre-wrap max-h-[220px] overflow-y-auto">
                            {m.outputs.report}
                          </div>
                        )}
                        {m.errors.length > 0 && (
                          <p className="mt-2 text-[12px] text-amber-300/90">{m.errors.length} noted error(s) — see timeline in debug.</p>
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
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-300"><CheckCircle2 size={13} /> Awaiting verification</span>
                          )}
                          {m.status === 'VERIFIED' && (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-200"><CheckCircle2 size={13} /> Verified outcome</span>
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
      status === 'COMPLETED' ? 'bg-emerald-400' : status === 'RUNNING' ? 'bg-cyan-200 animate-pulse'
      : status === 'FAILED' ? 'bg-red-400' : status === 'BLOCKED' ? 'bg-amber-300' : 'bg-zinc-600')} />
  );
}

function PanelBtn({ icon: Icon, label, onClick }: { icon: typeof Play; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-ghost h-9 px-3.5 text-[12.5px]">
      <Icon size={13} /> {label}
    </button>
  );
}
