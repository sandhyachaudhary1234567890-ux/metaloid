import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Plus, Search, Power, Eye, FlaskConical, Copy, Trash2, History, Upload, ChevronDown, FileUp, ShieldCheck } from 'lucide-react';
import { useApp } from '../lib/store';
import {
  fetchSkills, fetchSkill, createSkill, importSkill, validateSkill, uploadSkillZip,
  updateSkill, rollbackSkill, setSkillEnabled, duplicateSkill, deleteSkill,
  testSkill, fetchSkillDiff, fetchSkillRuntimes, type SkillCard, type SkillInspectPayload,
} from '../lib/transport';
import { cn } from '../lib/cn';

// Customize → Skills: Installed / My Skills / System tabs, cards, inspect,
// test, create wizard, import, update, rollback. Immediate availability:
// install/enable applies instantly, no restart.
export function SkillsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, connection, authUser, toast } = useApp();
  const online = connection === 'online' && !!authUser;
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [tab, setTab] = useState<'all' | 'mine' | 'project' | 'system'>('all');
  const [query, setQuery] = useState('');
  const [inspected, setInspected] = useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [zipInspect, setZipInspect] = useState<{ payload: SkillInspectPayload; zipBase64: string } | null>(null);
  const [runtimes, setRuntimes] = useState<{ kind: string; available: boolean; runs: string[]; note: string }[] | null>(null);
  const [updating, setUpdating] = useState<SkillCard | null>(null);
  const [testing, setTesting] = useState<{ skill: SkillCard; verdict: string; checks: { name: string; verdict: string; detail: string }[] } | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!online) return;
    try {
      setSkills(await fetchSkills(settings.backendUrl));
      if (!runtimes) {
        try {
          setRuntimes(await fetchSkillRuntimes(settings.backendUrl));
        } catch { /* runtimes advisory only */ }
      }
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Could not load skills.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, settings.backendUrl, toast]);

  useEffect(() => {
    if (open) {
      setInspected(null);
      setCreating(false);
      setImporting(false);
      load();
    }
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return skills.filter((s) => {
      if (tab === 'mine' && (s.source === 'system' || s.scope === 'global')) return false;
      if (tab === 'project' && s.scope !== 'project') return false;
      if (tab === 'system' && s.source !== 'system') return false;
      if (q && !`${s.name} ${s.description} ${s.command || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [skills, tab, query]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Action failed.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6"
          onClick={onClose}
          role="dialog"
          aria-label="Skills"
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-[720px] max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
              <div className="flex-1 min-w-0">
                <h2 className="text-title font-bold text-[var(--fg)]">Skills</h2>
                <p className="text-small text-[var(--fg-muted)]">Add once — Metaloid uses them when relevant.</p>
              </div>
              <button onClick={() => setCreating(true)} className="h-9 px-3.5 rounded-xl bg-[var(--accent-solid)] text-[var(--accent-on-solid)] text-ui font-semibold flex items-center gap-1.5" title="Create skill">
                <Plus size={15} /> New
              </button>
              <button onClick={() => setImporting(true)} className="h-9 px-3.5 rounded-xl border border-[var(--border)] text-ui font-medium flex items-center gap-1.5" title="Import skill.md">
                <Upload size={15} /> Import
              </button>
              <label className="h-9 px-3.5 rounded-xl border border-[var(--border)] text-ui font-medium flex items-center gap-1.5 cursor-pointer hover:border-[var(--accent)]" title="Upload .zip skill package">
                <FileUp size={15} /> ZIP
                <input
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    if (f.size > 1_600_000) {
                      toast({ title: 'ZIP too large (1.5MB max).' });
                      return;
                    }
                    const rd = new FileReader();
                    rd.onload = async () => {
                      const b64 = String(rd.result || '').split(',')[1] || '';
                      setBusy('zip');
                      try {
                        const payload = await validateSkill(settings.backendUrl, { zipBase64: b64 });
                        if (!payload.ok) {
                          toast({ title: payload.errors.join(' ') || 'ZIP rejected.' });
                        } else {
                          setZipInspect({ payload, zipBase64: b64 });
                        }
                      } catch (err) {
                        toast({ title: err instanceof Error ? err.message : 'ZIP validation failed.' });
                      } finally {
                        setBusy('');
                      }
                    };
                    rd.readAsDataURL(f);
                  }}
                />
              </label>
              <button onClick={onClose} className="icon-btn w-9 h-9 rounded-xl" aria-label="Close skills">
                <X size={17} />
              </button>
            </div>

            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)]">
              <div className="flex gap-1 p-1 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)]">
                {(['all', 'mine', 'project', 'system'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-small font-medium capitalize',
                      tab === t ? 'bg-[var(--surface-elevated)] text-[var(--fg)] border border-[var(--border)]' : 'text-[var(--fg-muted)]'
                    )}
                  >
                    {t === 'all' ? 'Installed' : t === 'mine' ? 'My Skills' : t === 'project' ? 'Project' : 'System'}
                  </button>
                ))}
              </div>
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search skills…"
                  className="h-9 w-full rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] pl-9 pr-3 text-ui outline-none"
                  aria-label="Search skills"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {runtimes && runtimes.some((r) => !r.available) && (
                <p className="text-micro text-[var(--fg-faint)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
                  {runtimes.filter((r) => r.available).map((r) => r.kind).join(', ')} live
                  {' · '}
                  {runtimes.filter((r) => !r.available).map((r) => `${r.kind} (${r.runs.join('/')})`).join(', ')} —{' '}
                  Python/Shell execution is not currently enabled in this environment; those scripts stay inert and are never executed.
                </p>
              )}
              {!online && <p className="text-ui text-[var(--fg-muted)]">Sign in with the gateway online to manage skills.</p>}
              {online && filtered.length === 0 && (
                <p className="text-ui text-[var(--fg-muted)]">
                  No skills yet. Create one — e.g. “YouTube SEO” with triggers “youtube, video ranking” — then just ask naturally.
                </p>
              )}
              {filtered.map((s) => (
                <div key={s.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3.5">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => act(`${s.id}:toggle`, async () => {
                        await setSkillEnabled(settings.backendUrl, s.id, s.status !== 'enabled');
                      })}
                      disabled={s.source === 'system' || busy !== ''}
                      title={s.source === 'system' ? 'System skills stay enabled' : s.status === 'enabled' ? 'Disable' : 'Enable'}
                      className={cn(
                        'mt-0.5 w-10 h-[24px] rounded-full p-0.5 transition-colors shrink-0',
                        s.status === 'enabled' ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
                        s.source === 'system' && 'opacity-50'
                      )}
                      role="switch"
                      aria-checked={s.status === 'enabled'}
                      aria-label={`Toggle ${s.name}`}
                    >
                      <span className={cn('block w-[18px] h-[18px] rounded-full bg-white transition-transform', s.status === 'enabled' && 'translate-x-4')} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-body font-semibold text-[var(--fg)]">
                        {s.name} <span className="font-mono font-normal text-micro text-[var(--fg-faint)]">v{s.version}</span>
                      </p>
                      <p className="text-small text-[var(--fg-muted)] line-clamp-2">{s.description}</p>
                      <p className="mt-1 text-micro text-[var(--fg-faint)]">
                        {s.scope} · {s.source}{s.command ? ` · /${s.command}` : ''}{s.lastUsedAt ? ` · used ${new Date(s.lastUsedAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    <PanelBtn icon={<Eye size={13} />} label="Inspect" onClick={async () => {
                      try {
                        setInspected(await fetchSkill(settings.backendUrl, s.id));
                      } catch (e) {
                        toast({ title: e instanceof Error ? e.message : 'Inspect failed.' });
                      }
                    }} />
                    {s.source !== 'system' && (
                      <>
                        <PanelBtn icon={<FlaskConical size={13} />} label="Test" busy={busy === `${s.id}:test`} onClick={() => act(`${s.id}:test`, async () => {
                          const r = await testSkill(settings.backendUrl, s.id, {});
                          setTesting({ skill: s, verdict: r.verdict, checks: r.checks });
                        })} />
                        <PanelBtn icon={<Copy size={13} />} label="Duplicate" onClick={() => act(`${s.id}:dup`, async () => {
                          const r = await duplicateSkill(settings.backendUrl, s.id);
                          toast({ title: `Duplicated as ${r.name}.` });
                        })} />
                        <PanelBtn icon={<ChevronDown size={13} />} label="Update" onClick={() => setUpdating(s)} />
                        <PanelBtn icon={<Trash2 size={13} />} label="Delete" danger onClick={() => act(`${s.id}:del`, async () => {
                          await deleteSkill(settings.backendUrl, s.id);
                        })} />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {inspected && <InspectView data={inspected} backendUrl={settings.backendUrl} onClose={() => setInspected(null)} onChanged={load} />}
            {zipInspect && (
              <PreInstallInspect
                payload={zipInspect.payload}
                onCancel={() => setZipInspect(null)}
                onInstall={async () => {
                  setBusy('zip-install');
                  try {
                    const r = await uploadSkillZip(settings.backendUrl, zipInspect.zipBase64);
                    toast({ title: `Installed ${r.skill.name}.${r.warnings.length ? ' ' + r.warnings[0] : ''}` });
                    setZipInspect(null);
                    load();
                  } catch (e) {
                    toast({ title: e instanceof Error ? e.message : 'Install failed.' });
                  } finally {
                    setBusy('');
                  }
                }}
                installing={busy === 'zip-install'}
              />
            )}
            {creating && <CreateWizard backendUrl={settings.backendUrl} onClose={() => setCreating(false)} onSaved={load} />}
            {importing && <ImportView backendUrl={settings.backendUrl} onClose={() => setImporting(false)} onSaved={load} />}
            {updating && <UpdateView skill={updating} backendUrl={settings.backendUrl} onClose={() => setUpdating(null)} onSaved={load} />}
            {testing && (
              <SubSheet title={`Test — ${testing.skill.name}`} onClose={() => setTesting(null)}>
                <p className={cn('text-body font-bold', testing.verdict === 'PASS' ? 'text-success' : testing.verdict === 'WARN' ? 'text-warning' : 'text-danger')}>
                  {testing.verdict}
                </p>
                <div className="mt-2 space-y-1.5">
                  {testing.checks.map((c) => (
                    <div key={c.name} className="flex gap-2 text-small">
                      <span className={cn('font-semibold w-12 shrink-0', c.verdict === 'PASS' ? 'text-success' : c.verdict === 'WARN' ? 'text-warning' : 'text-danger')}>
                        {c.verdict}
                      </span>
                      <span className="text-[var(--fg)]">{c.name} <span className="text-[var(--fg-muted)]">— {c.detail}</span></span>
                    </div>
                  ))}
                </div>
              </SubSheet>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PanelBtn({ icon, label, onClick, danger, busy }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={!!busy}
      className={cn(
        'h-8 px-2.5 rounded-lg border text-small font-medium flex items-center gap-1.5 disabled:opacity-50',
        danger
          ? 'border-danger/30 text-danger hover:bg-danger/10'
          : 'border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--fg-faint)]'
      )}
    >
      {icon} {busy ? '…' : label}
    </button>
  );
}

function SubSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-[560px] max-h-[80%] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-read font-bold text-[var(--fg)] flex-1">{title}</h3>
          <button onClick={onClose} className="icon-btn w-8 h-8 rounded-lg" aria-label="Close">
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PreInstallInspect({ payload, onCancel, onInstall, installing }: {
  payload: SkillInspectPayload;
  onCancel: () => void;
  onInstall: () => void;
  installing: boolean;
}) {
  const ins = payload.inspect;
  const sec = payload.security;
  return (
    <SubSheet title="Inspect package — nothing installed yet" onClose={onCancel}>
      {!ins ? (
        <p className="text-ui text-danger">{payload.errors.join(' ')}</p>
      ) : (
        <>
          <p className="text-read font-bold text-[var(--fg)]">{ins.name} <span className="font-mono font-normal text-micro text-[var(--fg-faint)]">v{ins.version}</span></p>
          <p className="text-ui text-[var(--fg-muted)] mt-1">{ins.description}</p>
          {payload.warnings.map((w, i) => (
            <p key={i} className="mt-1.5 text-small text-warning">⚠ {w}</p>
          ))}
          <div className="grid grid-cols-2 gap-2 mt-3 text-small">
            <Info label="Author" value={String(ins.author || '')} />
            <Info label="License" value={String(ins.license || '')} />
            <Info label="Files" value={ins.files.join(', ') || '—'} />
            <Info label="Scripts" value={ins.scripts.join(', ') || '—'} />
            <Info label="Tools" value={ins.tools.join(', ') || '—'} />
            <Info label="Plugins" value={ins.plugins.join(', ') || '—'} />
            <Info label="Providers" value={ins.providers.join(', ') || '—'} />
            <Info label="Permissions" value={JSON.stringify(ins.permissions)} />
            <Info label="Tool coverage" value={`known: ${ins.toolCoverage.known.join(', ') || '—'} · unknown: ${ins.toolCoverage.unknown.join(', ') || '—'}`} />
            <Info label="Security" value={`${sec?.risk || 'low'} (${sec?.findings.length || 0} findings)`} />
          </div>
          {(sec?.findings.length || 0) > 0 && (
            <div className="mt-2 space-y-1">
              {sec!.findings.map((f, i) => (
                <p key={i} className={cn('text-micro', f.level === 'high' ? 'text-danger' : 'text-warning')}>
                  <ShieldCheck size={11} className="inline mr-1" />[{f.level}] {f.file}: {f.issue}
                </p>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={onCancel} className="btn-ghost h-10 px-4 text-ui flex-1">Cancel</button>
            <button
              onClick={onInstall}
              disabled={installing}
              className="h-10 px-4 rounded-xl bg-[var(--accent-solid)] text-[var(--accent-on-solid)] text-ui font-semibold flex-1 disabled:opacity-50"
            >
              {installing ? 'Installing…' : 'Install Skill'}
            </button>
          </div>
        </>
      )}
    </SubSheet>
  );
}

function InspectView({ data, backendUrl, onClose, onChanged }: { data: Record<string, unknown>; backendUrl: string; onClose: () => void; onChanged: () => void }) {
  const { toast } = useApp();
  const versions = (data.versions as { version: string; at: string; note: string }[]) || [];
  const audit = (data.audit as { at: string; event: string; detail: string }[]) || [];
  const [diffFrom, setDiffFrom] = useState('');
  const [diff, setDiff] = useState<Record<string, unknown> | null>(null);
  return (
    <SubSheet title={String(data.name || 'Skill')} onClose={onClose}>
      <p className="text-ui text-[var(--fg-muted)]">{String(data.description || '')}</p>
      <div className="mt-3 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] p-3 max-h-56 overflow-y-auto">
        <pre className="text-small whitespace-pre-wrap text-[var(--fg)]">{String(data.instructions || '(no instructions)')}</pre>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-small">
        <Info label="Version" value={String(data.version || '')} />
        <Info label="Scope" value={String(data.scope || '')} />
        <Info label="Tools" value={((data.tools as string[]) || []).join(', ') || '—'} />
        <Info label="Permissions" value={JSON.stringify(data.permissions || {})} />
        <Info label="Triggers" value={((data.triggers as string[]) || []).join(', ') || '—'} />
        <Info label="Security" value={JSON.stringify((data.security as { risk?: string })?.risk || 'low')} />
      </div>
      {versions.length > 1 && (
        <div className="mt-3">
          <p className="text-small font-semibold text-[var(--fg-muted)] flex items-center gap-1.5"><History size={13} /> Versions, rollback & diff</p>
          <div className="mt-1.5 space-y-1">
            {versions.slice().reverse().map((v) => (
              <div key={v.version + v.at} className="flex items-center gap-2 text-small">
                <span className="font-mono text-[var(--fg)]">v{v.version}</span>
                <span className="text-[var(--fg-muted)] flex-1 truncate">{v.note}</span>
                <button
                  onClick={async () => {
                    try {
                      await rollbackSkill(backendUrl, String(data.id), v.version);
                      toast({ title: `Rolled back to v${v.version}.` });
                      onChanged();
                      onClose();
                    } catch (e) {
                      toast({ title: e instanceof Error ? e.message : 'Rollback failed.' });
                    }
                  }}
                  className="text-[var(--accent)] hover:underline"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <select
              value={diffFrom}
              onChange={(e) => setDiffFrom(e.target.value)}
              className="h-8 rounded-lg bg-[var(--surface-sunken)] border border-[var(--border)] px-2 text-small"
              aria-label="Diff from version"
            >
              <option value="">Diff from…</option>
              {versions.map((v) => (
                <option key={v.version + v.at} value={v.version}>v{v.version}</option>
              ))}
            </select>
            <button
              disabled={!diffFrom}
              onClick={async () => {
                try {
                  setDiff(await fetchSkillDiff(backendUrl, String(data.id), diffFrom));
                } catch (e) {
                  toast({ title: e instanceof Error ? e.message : 'Diff failed.' });
                }
              }}
              className="h-8 px-3 rounded-lg border border-[var(--border)] text-small disabled:opacity-50"
            >
              Compare to current
            </button>
          </div>
          {diff && <DiffRender diff={(diff.diff as Record<string, unknown>) || {}} />}
        </div>
      )}
      {audit.length > 0 && (
        <div className="mt-3">
          <p className="text-small font-semibold text-[var(--fg-muted)]">Recent activity</p>
          <div className="mt-1 space-y-1">
            {audit.slice().reverse().slice(0, 8).map((a, i) => (
              <p key={i} className="text-micro text-[var(--fg-faint)]">
                {new Date(a.at).toLocaleString()} · {a.event}{a.detail ? ` — ${a.detail}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}
    </SubSheet>
  );
}

function DiffRender({ diff }: { diff: Record<string, unknown> }) {
  const rows: { label: string; body: string; hot?: boolean }[] = [];
  if (typeof diff.instructionsChanged === 'boolean') {
    rows.push({ label: 'Instructions', body: diff.instructionsChanged ? 'changed' : 'unchanged' });
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v.join(', ') || '—' : '—');
  for (const k of ['filesAdded', 'filesRemoved']) {
    if (Array.isArray(diff[k])) rows.push({ label: k, body: arr(diff[k]) });
  }
  for (const [k, v] of Object.entries(diff)) {
    if (['instructionsChanged', 'filesAdded', 'filesRemoved'].includes(k)) continue;
    if (k === 'permissions' && v && typeof v === 'object') {
      const p = v as Record<string, unknown>;
      const esc = Array.isArray(p.escalated) ? (p.escalated as string[]) : [];
      for (const [pk, pv] of Object.entries(p)) {
        if (pk === 'escalated') continue;
        const ch = pv as { from: unknown; to: unknown };
        rows.push({ label: `permission:${pk}`, body: `${JSON.stringify(ch.from)} → ${JSON.stringify(ch.to)}`, hot: esc.includes(pk) });
      }
      if (esc.length) rows.push({ label: '⚠ Escalated permissions', body: esc.join(', '), hot: true });
    } else if (v && typeof v === 'object' && ('added' in (v as object) || 'from' in (v as object))) {
      const vv = v as { added?: unknown[]; removed?: unknown[]; from?: unknown; to?: unknown };
      rows.push({
        label: k,
        body: vv.added ? `+${arr(vv.added)} −${arr(vv.removed)}` : `${JSON.stringify(vv.from)} → ${JSON.stringify(vv.to)}`,
      });
    }
  }
  if (!rows.length) return <p className="text-small text-[var(--fg-muted)] mt-1">No differences.</p>;
  return (
    <div className="mt-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2.5 space-y-1">
      {rows.map((r, i) => (
        <p key={i} className={cn('text-small', r.hot ? 'text-danger font-semibold' : 'text-[var(--fg)]')}>
          <span className="text-[var(--fg-muted)]">{r.label}:</span> {r.body}
        </p>
      ))}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-sunken)] border border-[var(--border-subtle)] px-2.5 py-1.5">
      <p className="text-micro uppercase tracking-wide text-[var(--fg-faint)]">{label}</p>
      <p className="text-small text-[var(--fg)] break-words">{value || '—'}</p>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, textarea, tall }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; textarea?: boolean; tall?: boolean;
}) {
  return (
    <label className="block mt-2.5">
      <span className="text-small font-medium text-[var(--fg-muted)]">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn('mt-1 w-full rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] p-3 text-ui outline-none', tall ? 'h-40' : 'h-20')}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 h-10 w-full rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] px-3 text-ui outline-none"
        />
      )}
    </label>
  );
}

function CreateWizard({ backendUrl, onClose, onSaved }: { backendUrl: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [triggers, setTriggers] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await createSkill(backendUrl, { name, description, instructions, triggers, command, types: ['knowledge', 'workflow'] });
      toast({ title: `Installed.${r.warnings.length ? ' ' + r.warnings[0] : ''}` });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Create failed.' });
      setBusy(false);
    }
  };
  return (
    <SubSheet title="Create Skill" onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} placeholder="YouTube SEO" />
      <Field label="Description — WHAT it does + WHEN it activates (20+ chars, discovery depends on this)" textarea value={description} onChange={setDescription} placeholder="Optimize YouTube titles… Activates when the user asks about video ranking…" />
      <Field label="Instructions / workflow" textarea tall value={instructions} onChange={setInstructions} placeholder="## Workflow&#10;1. …&#10;2. …&#10;## Verification&#10;- …" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Triggers (comma separated)" value={triggers} onChange={setTriggers} placeholder="youtube, video ranking" />
        <Field label="Command (optional, no slash)" value={command} onChange={(v) => setCommand(v.replace(/^\//, ''))} placeholder="youtube-seo" />
      </div>
      <button
        onClick={save}
        disabled={busy || name.trim().length < 2 || description.trim().length < 20}
        className="mt-3 h-10 w-full rounded-xl bg-[var(--accent-solid)] text-[var(--accent-on-solid)] text-ui font-semibold disabled:opacity-50"
      >
        {busy ? 'Validating & installing…' : 'Create & install'}
      </button>
    </SubSheet>
  );
}

function ImportView({ backendUrl, onClose, onSaved }: { backendUrl: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [md, setMd] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await importSkill(backendUrl, { 'skill.md': md });
      toast({ title: `Installed.${r.warnings.length ? ' ' + r.warnings[0] : ''}` });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Import failed.' });
      setBusy(false);
    }
  };
  return (
    <SubSheet title="Import skill.md" onClose={onClose}>
      <p className="text-small text-[var(--fg-muted)] mb-2">Paste a skill.md with YAML frontmatter (name, description 20+ chars, version). Scanned before install; ZIP files are not accepted.</p>
      <textarea
        value={md}
        onChange={(e) => setMd(e.target.value)}
        placeholder={'---\nname: YouTube SEO\ndescription: …\nversion: 1.0.0\n---\n\n## Workflow\n…'}
        className="h-56 w-full rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] p-3 font-mono text-small outline-none"
        aria-label="skill.md content"
      />
      <button
        onClick={save}
        disabled={busy || !md.trim()}
        className="mt-3 h-10 w-full rounded-xl bg-[var(--accent-solid)] text-[var(--accent-on-solid)] text-ui font-semibold disabled:opacity-50"
      >
        {busy ? 'Validating & installing…' : 'Validate & install'}
      </button>
    </SubSheet>
  );
}

function UpdateView({ skill, backendUrl, onClose, onSaved }: { skill: SkillCard; backendUrl: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [md, setMd] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      // validate first via import-validate path, then update (previous version preserved)
      const v = await validateSkill(backendUrl, { 'skill.md': md });
      if (!v.ok) throw new Error(v.errors.join(' '));
      const r = await updateSkill(backendUrl, skill.id, { 'skill.md': md }, 'manual update');
      toast({ title: `Updated to v${r.skill.version}.${r.warnings.length ? ' ' + r.warnings[0] : ''}` });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Update failed.' });
      setBusy(false);
    }
  };
  return (
    <SubSheet title={`Update — ${skill.name}`} onClose={onClose}>
      <p className="text-small text-[var(--fg-muted)] mb-2">Paste the revised skill.md. The current v{skill.version} is preserved for rollback.</p>
      <textarea
        value={md}
        onChange={(e) => setMd(e.target.value)}
        placeholder="Revised skill.md with frontmatter…"
        className="h-56 w-full rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] p-3 font-mono text-small outline-none"
        aria-label="revised skill.md"
      />
      <button
        onClick={save}
        disabled={busy || !md.trim()}
        className="mt-3 h-10 w-full rounded-xl bg-[var(--accent-solid)] text-[var(--accent-on-solid)] text-ui font-semibold disabled:opacity-50"
      >
        {busy ? 'Validating…' : 'Validate & update'}
      </button>
    </SubSheet>
  );
}
