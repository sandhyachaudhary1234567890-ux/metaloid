import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Radar, Copy, Download, ExternalLink, ShieldAlert, Check } from 'lucide-react';
import { useApp } from '../lib/store';
import {
  osintCreate, osintRun, osintGet, osintFindings, osintReportUrl,
  type OsintFinding,
} from '../lib/transport';
import { cn } from '../lib/cn';

// METALOID OSINT workspace (§20 contextual surface, not a route).
// Passive public sources only. Every finding shows provenance.
// Username matches are medium-confidence LEADS, never identity proof.

const TYPE_FILTERS = ['all', 'subdomain', 'ip', 'email', 'profile', 'repository', 'record'] as const;
const CONF_FILTERS = ['all', 'high', 'medium', 'low'] as const;
const TYPE_COLOR: Record<string, string> = {
  subdomain: 'text-[var(--accent)] border-cyan-200/25 bg-cyan-300/[0.06]',
  ip: 'text-blue-300 border-blue-400/25 bg-blue-400/[0.06]',
  email: 'text-violet-300 border-violet-400/25 bg-violet-400/[0.06]',
  profile: 'text-purple-300 border-purple-400/25 bg-purple-400/[0.06]',
  repository: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/[0.06]',
  record: 'text-[var(--fg-secondary)] border-[var(--border)] bg-[var(--surface-sunken)]',
};

type JobState = {
  id: string; target: string; type: string; status: string; progress: number;
  collectors: { id: string; name: string; state: string }[];
  timeline: { at: string; event: string; detail: string }[];
  finding_count: number;
} | null;

export function OsintPanel() {
  const { osintOpen, setOsintOpen, osintTarget, settings, toast, connection } = useApp();
  const [target, setTarget] = useState('');
  const [authed, setAuthed] = useState(false);
  const [job, setJob] = useState<JobState>(null);
  const [findings, setFindings] = useState<OsintFinding[]>([]);
  const [tab, setTab] = useState<'findings' | 'graph' | 'timeline'>('findings');
  const [typeF, setTypeF] = useState<string>('all');
  const [confF, setConfF] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<number | null>(null);
  const online = connection === 'online';
  const base = settings.backendUrl;

  useEffect(() => {
    if (osintOpen) {
      setTarget(osintTarget || '');
      setError('');
    } else {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [osintOpen, osintTarget]);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const start = async () => {
    if (!online) {
      setError('No gateway connection, so research cannot run. Check Settings.');
      return;
    }
    if (!target.trim()) {
      setError('Enter a target first.');
      return;
    }
    if (!authed) {
      setError('Confirm you own or are authorized to investigate this target.');
      return;
    }
    setBusy(true);
    setError('');
    setFindings([]);
    try {
      const inv = await osintCreate(base, target.trim());
      await osintRun(base, inv.id);
      const poll = async () => {
        try {
          const j = await osintGet(base, inv.id);
          setJob(j);
          const f = await osintFindings(base, inv.id);
          setFindings(f);
          if (['complete', 'partial', 'failed'].includes(j.status)) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(false);
          }
        } catch (e) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
          setError(e instanceof Error ? e.message : 'Polling failed.');
        }
      };
      await poll();
      pollRef.current = window.setInterval(poll, 1500);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not start investigation.');
    }
  };

  const filtered = useMemo(
    () => findings.filter((f) => (typeF === 'all' || f.type === typeF) && (confF === 'all' || f.confidence === confF)),
    [findings, typeF, confF]
  );

  const download = async (format: 'json' | 'csv') => {
    if (!job) return;
    try {
      const res = await fetch(osintReportUrl(base, job.id, format));
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${job.id}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: 'Export failed', desc: 'Retry in a moment' });
    }
  };

  const stateLabel: Record<string, string> = {
    queued: 'Queued', collecting: 'Collecting', normalizing: 'Normalizing',
    correlating: 'Correlating', complete: 'Complete', partial: 'Partial', failed: 'Failed',
  };

  return (
    <AnimatePresence>
      {osintOpen && (
        <>
          <motion.div className="fixed inset-0 z-[75] bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOsintOpen(false)} />
          <motion.div
            initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed top-0 right-0 bottom-0 z-[76] w-full sm:w-[540px] border-l border-[var(--border)] bg-[var(--surface)] flex flex-col"
            role="dialog" aria-label="Research workspace"
          >
            {/* header */}
            <div className="px-6 pt-5 pb-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-2xl bg-[var(--accent-subtle)] border border-[var(--accent)]/25 flex items-center justify-center">
                  <Radar size={18} className="text-[var(--accent)]" />
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[17px] font-semibold tracking-tight">Research</h3>
                  <p className="text-[12.5px] text-[var(--fg-muted)]">Public sources · every finding cited</p>
                </div>
                <button onClick={() => setOsintOpen(false)} className="icon-btn w-9 h-9" aria-label="Close research"><X size={17} /></button>
              </div>
              {/* target row */}
              <div className="mt-4 flex gap-2">
                <input
                  value={target} onChange={(e) => setTarget(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
                  placeholder="example.com · username · email · org · github repo URL"
                  className="flex-1 h-12 rounded-2xl bg-[var(--surface-sunken)] border border-[var(--border)] px-4 text-[14px] outline-none focus:border-[var(--accent)] placeholder:text-[var(--fg-subtle)] min-w-0"
                  aria-label="Investigation target"
                />
                <button onClick={start} disabled={busy} className="btn-primary h-12 px-5 text-[14px] shrink-0 disabled:opacity-50 min-w-[88px]">
                  {busy ? 'Researching…' : 'Start'}
                </button>
              </div>
              <label className="mt-3 flex items-start gap-2.5 text-[12.5px] text-[var(--fg-muted)] cursor-pointer">
                <input
                  type="checkbox" checked={authed} onChange={(e) => setAuthed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-cyan-300"
                />
                <span>I own this target or am authorized to investigate it. Public sources only — no private data, no bypasses.</span>
              </label>
              {error && (
                <div className="mt-3 flex items-start gap-2 rounded-2xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3 text-[13px] text-red-200" role="alert">
                  <ShieldAlert size={15} className="shrink-0 mt-0.5" /> {error}
                </div>
              )}
            </div>

            {/* progress */}
            {job && (
              <div className="px-6 py-3.5 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2.5">
                  <span className={cn('text-[12px] font-bold tracking-[0.14em]',
                    job.status === 'complete' ? 'text-emerald-300' : job.status === 'failed' ? 'text-red-300' : 'text-[var(--accent)]')}>
                    {(stateLabel[job.status] || job.status).toUpperCase()}
                  </span>
                  <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-200 to-violet-300 transition-all duration-500" style={{ width: `${job.progress}%` }} />
                  </div>
                  <span className="text-[12px] text-[var(--fg-muted)]">{job.finding_count} findings</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {job.collectors.map((c) => (
                    <span key={c.id} title={c.name} className={cn('inline-flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 border',
                      c.state === 'done' ? 'text-emerald-300 border-emerald-400/25 bg-emerald-400/[0.06]'
                      : c.state === 'running' ? 'text-[var(--accent)] border-cyan-200/25 bg-cyan-300/[0.06]'
                      : c.state === 'failed' ? 'text-red-300 border-red-500/25 bg-red-500/[0.06]'
                      : 'text-[var(--fg-muted)] border-[var(--border)]')}>
                      <span className={cn('w-1.5 h-1.5 rounded-full',
                        c.state === 'done' ? 'bg-emerald-400' : c.state === 'running' ? 'bg-cyan-200 animate-pulse' : c.state === 'failed' ? 'bg-red-400' : 'bg-[var(--fg-subtle)]')} />
                      {c.id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* tabs */}
            {job && (
              <div className="px-6 pt-3 flex items-center gap-1.5">
                {(['findings', 'graph', 'timeline'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
                    className={cn('px-4 h-10 rounded-xl text-[13px] font-medium capitalize transition-all min-w-[44px]',
                      tab === t ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)]')}>
                    {t}{t === 'findings' ? ` (${filtered.length})` : ''}
                  </button>
                ))}
                <span className="ml-auto flex gap-1.5">
                  <button onClick={() => download('json')} className="icon-btn w-9 h-9" title="Export JSON" aria-label="Export JSON"><Download size={15} /></button>
                  <button onClick={() => download('csv')} className="btn-ghost h-9 px-3 text-[12px]" title="Export CSV">CSV</button>
                </span>
              </div>
            )}

            {/* body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!job ? (
                <div className="py-10 text-center">
                  <Radar size={26} className="mx-auto text-[var(--fg-subtle)]" />
                  <p className="mt-3 text-[14.5px] text-[var(--fg-secondary)]">Nothing researched yet.</p>
                  <p className="text-[13px] text-[var(--fg-muted)] mt-1 max-w-[360px] mx-auto">
                    Enter a domain, username, organization or repository above. Findings come from public sources, and each one is cited.
                  </p>
                </div>
              ) : tab === 'timeline' ? (
                <div className="space-y-0.5">
                  {job.timeline.map((e, i) => (
                    <div key={i} className="flex gap-3 py-2.5 border-b border-[var(--border-subtle)]">
                      <span className="text-[11px] font-mono text-[var(--fg-subtle)] shrink-0 mt-0.5 w-[62px]">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium">{e.event}</span>
                        {e.detail && <span className="block text-[12.5px] text-[var(--fg-muted)]">{e.detail}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              ) : tab === 'graph' ? (
                <GraphView target={job.target} findings={findings} />
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {TYPE_FILTERS.map((f) => (
                      <button key={f} onClick={() => setTypeF(f)} aria-pressed={typeF === f}
                        className={cn('px-3 h-8 rounded-full text-[12px] border capitalize min-w-[36px]', typeF === f ? 'bg-[var(--accent-subtle)] border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--fg-muted)]')}>{f}</button>
                    ))}
                    <span className="w-px bg-white/10 mx-1" />
                    {CONF_FILTERS.map((f) => (
                      <button key={f} onClick={() => setConfF(f)} aria-pressed={confF === f}
                        className={cn('px-3 h-8 rounded-full text-[12px] border capitalize min-w-[36px]', confF === f ? 'bg-[var(--accent-subtle)] border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--fg-muted)]')}>{f}</button>
                    ))}
                  </div>
                  {filtered.length === 0 ? (
                    <p className="text-[13px] text-[var(--fg-muted)] text-center py-8">
                      {busy ? 'Collecting — findings appear here with provenance.' : 'No findings match. Broaden the filters — or insufficient evidence.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map((f, i) => (
                        <div key={`${f.type}-${f.value}-${i}`} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn('text-[10.5px] font-bold tracking-[0.1em] rounded-full px-2 py-0.5 border', TYPE_COLOR[f.type] ?? TYPE_COLOR.record)}>{f.type.toUpperCase()}</span>
                            <span className={cn('inline-flex items-center gap-1 text-[11px]', f.confidence === 'high' ? 'text-emerald-300' : f.confidence === 'medium' ? 'text-amber-300' : 'text-[var(--fg-muted)]')}>
                              <Check size={11} /> {f.confidence}
                            </span>
                            <button
                              onClick={() => { navigator.clipboard?.writeText(f.value).catch(() => {}); toast({ title: 'Finding copied' }); }}
                              className="icon-btn w-7 h-7 ml-auto" aria-label="Copy finding"><Copy size={13} /></button>
                          </div>
                          <p className="mt-1.5 font-mono text-[13px] text-[var(--fg)] break-all">{f.value}</p>
                          {f.evidence && <p className="mt-1 text-[12.5px] text-[var(--fg-muted)]">{f.evidence}</p>}
                          <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[var(--fg-muted)]">
                            <span>via <span className="text-[var(--fg-secondary)] font-medium">{f.source}</span></span>
                            {f.source_url && (
                              <a href={f.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)]/80 hover:text-cyan-100">
                                open source <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-4 text-[12px] text-[var(--fg-subtle)]">Username matches are leads, not identity proof. Verify before acting.</p>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function GraphView({ target, findings }: { target: string; findings: OsintFinding[] }) {
  const nodes = findings.slice(0, 24);
  const R = 150;
  const cx = 170;
  const cy = 160;
  const colorOf = (t: string) =>
    t === 'subdomain' ? '#7ef0e2' : t === 'ip' ? '#60a5fa' : t === 'email' ? '#a78bfa'
    : t === 'profile' ? '#c084fc' : t === 'repository' ? '#34d399' : '#9aa3b5';
  if (!nodes.length) return <p className="text-[13px] text-[var(--fg-muted)] text-center py-8">Graph appears when findings arrive.</p>;
  return (
    <div>
      <svg viewBox="0 0 340 320" className="w-full" role="img" aria-label="Investigation graph">
        {nodes.map((n, i) => {
          const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * R * 0.72;
          const y = cy + Math.sin(a) * R * 0.62;
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
              <circle cx={x} cy={y} r="5" fill={colorOf(n.type)} opacity="0.9">
                <title>{`${n.type}: ${n.value} (${n.confidence}, via ${n.source})`}</title>
              </circle>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r="9" fill="#eef2f7" />
        <circle cx={cx} cy={cy} r="14" fill="none" stroke="rgba(126,240,226,0.5)" strokeWidth="1.5" />
        <text x={cx} y={cy + 32} textAnchor="middle" fill="#9aa3b5" fontSize="10" fontFamily="monospace">{target.slice(0, 28)}</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--fg-muted)]">
        {['subdomain', 'ip', 'email', 'profile', 'repository', 'record'].map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: colorOf(t) }} /> {t}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[var(--fg-subtle)]">Edges = documented collection, not inferred relationships. Hover a node for provenance.</p>
    </div>
  );
}
