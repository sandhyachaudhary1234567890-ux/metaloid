import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, CheckCircle2, Clock3, FolderPlus, Library, Loader2, Play, Plus, RefreshCw, Search, Telescope } from 'lucide-react';
import { useApp } from '../lib/store';
import {
  createWorkspace, fetchArtifacts, fetchWorkspaces, missionList, missionRun,
  type ArtifactMeta, type Mission, type Workspace,
} from '../lib/transport';
import { ArtifactCard } from '../components/ArtifactCard';
import { cn } from '../lib/cn';

type ScreenKind = 'projects' | 'library' | 'research' | 'tasks';

const COPY: Record<ScreenKind, { title: string; subtitle: string }> = {
  projects: { title: 'Projects', subtitle: 'Persistent, isolated workspaces with their own instructions and artifacts.' },
  library: { title: 'Library', subtitle: 'Files created by MetaIoid. Nothing appears here until it exists on the server.' },
  research: { title: 'Research', subtitle: 'Run a cited investigation and keep its findings with the work.' },
  tasks: { title: 'Tasks', subtitle: 'Long-running agent work with real runtime state and resumable checkpoints.' },
};

export function WorkspaceScreen({ kind }: { kind: ScreenKind }) {
  const { settings, connection, toast, setOsintOpen, setOsintTarget, setMissionsOpen, setMissionDraft, openModal } = useApp();
  const [projects, setProjects] = useState<Workspace[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactMeta[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const online = connection === 'online';
  const refresh = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    setError('');
    try {
      if (kind === 'projects') setProjects(await fetchWorkspaces(settings.backendUrl));
      if (kind === 'library') setArtifacts(await fetchArtifacts(settings.backendUrl));
      if (kind === 'tasks') setMissions(await missionList(settings.backendUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this workspace.');
    } finally {
      setLoading(false);
    }
  }, [kind, online, settings.backendUrl]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createProject = async (name: string) => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const item = await createWorkspace(settings.backendUrl, { name: name.trim() });
      setProjects((items) => [item, ...items]);
      toast({ title: 'Project created', desc: `${item.name} is ready for instructions and artifacts.` });
    } catch (e) {
      toast({ title: 'Could not create project', desc: e instanceof Error ? e.message : undefined, tone: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const askProjectName = () => openModal('new-project', { onCreate: (name: string) => void createProject(name) });

  const runMission = async (id: string) => {
    try {
      await missionRun(settings.backendUrl, id);
      await refresh();
      toast({ title: 'Task started' });
    } catch (e) {
      toast({ title: 'Task could not start', desc: e instanceof Error ? e.message : undefined });
    }
  };

  const filteredProjects = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())), [projects, query]);
  const filteredArtifacts = useMemo(() => artifacts.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())), [artifacts, query]);
  const filteredMissions = useMemo(() => missions.filter((m) => m.objective.toLowerCase().includes(query.toLowerCase())), [missions, query]);
  const copy = COPY[kind];

  return (
    <div className="max-w-[1120px] mx-auto px-4 sm:px-7 py-7 pb-28">
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-[var(--accent)]">MetaIoid workspace</p>
          <h1 className="mt-1 text-[28px] font-bold tracking-tight">{copy.title}</h1>
          <p className="mt-1 max-w-[650px] text-[13.5px] text-[var(--fg-muted)]">{copy.subtitle}</p>
        </div>
        {kind === 'projects' && <button disabled={!online || creating} onClick={askProjectName} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50"><FolderPlus size={15} /> {creating ? 'Creating…' : 'New project'}</button>}
        {kind === 'research' && <button disabled={!online} onClick={() => { setOsintTarget(''); setOsintOpen(true); }} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50"><Telescope size={15} /> New investigation</button>}
        {kind === 'tasks' && <button disabled={!online} onClick={() => { setMissionDraft(''); setMissionsOpen(true); }} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50"><Plus size={15} /> New task</button>}
      </div>

      {!online ? (
        <Unavailable kind={kind} />
      ) : kind === 'research' ? (
        <ResearchEmpty onOpen={() => { setOsintTarget(''); setOsintOpen(true); }} />
      ) : (
        <>
          <div className="mt-6 flex gap-2">
            <label className="flex-1 flex items-center gap-2 h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--fg-muted)]">
              <Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none text-[13px] text-[var(--fg)]" placeholder={`Search ${copy.title.toLowerCase()}…`} aria-label={`Search ${copy.title.toLowerCase()}`} />
            </label>
            <button onClick={() => void refresh()} className="icon-btn w-10 h-10" title="Refresh" aria-label="Refresh"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
          </div>
          {error && <div role="alert" className="mt-4 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3 text-[13px] text-red-600 dark:text-red-300">{error}</div>}
          {loading ? <Loading /> : kind === 'projects' ? <Projects items={filteredProjects} onCreate={askProjectName} /> : kind === 'library' ? <LibraryItems items={filteredArtifacts} /> : <Tasks items={filteredMissions} onRun={runMission} />}
        </>
      )}
    </div>
  );
}

function Unavailable({ kind }: { kind: ScreenKind }) {
  return <div className="mt-8 max-w-[560px] rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-5"><p className="font-semibold text-[14px]">This {kind} workspace needs the MetaIoid gateway.</p><p className="mt-1 text-[13px] text-[var(--fg-muted)]">It is unavailable in local demo mode, so no sample projects, files, or task states are shown.</p></div>;
}
function Loading() { return <div className="mt-8 flex items-center gap-2 text-[13px] text-[var(--fg-muted)]"><Loader2 size={15} className="animate-spin" /> Loading live data…</div>; }
function Projects({ items, onCreate }: { items: Workspace[]; onCreate: () => void }) {
  if (!items.length) return <Empty icon={FolderPlus} title="No projects yet" text="Start a workspace for something you’re building. Its instructions stay scoped to that project." action="Create project" onAction={onCreate} />;
  return <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{items.map((p) => <article key={p.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-start gap-3"><span className="w-9 h-9 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center"><Archive size={16} /></span><div className="min-w-0"><h2 className="font-semibold text-[14px] truncate">{p.name}</h2><p className="mt-0.5 text-[11.5px] text-[var(--fg-muted)] capitalize">{p.kind} · updated {new Date(p.updatedAt).toLocaleDateString()}</p></div></div><p className="mt-3 text-[12.5px] min-h-9 text-[var(--fg-muted)]">{p.instructions || 'No project instructions yet.'}</p><p className="mt-3 text-[11.5px] text-[var(--fg-faint)]">{p.files.length} attached file{p.files.length === 1 ? '' : 's'}</p></article>)}</div>;
}
function LibraryItems({ items }: { items: ArtifactMeta[] }) {
  if (!items.length) return <Empty icon={Library} title="Your library is empty" text="Generated documents and presentations will appear here only after the artifact pipeline finishes." />;
  return <div className="mt-5 grid sm:grid-cols-2 gap-3">{items.map((a) => <ArtifactCard key={a.id} artifact={a} />)}</div>;
}
function Tasks({ items, onRun }: { items: Mission[]; onRun: (id: string) => void }) {
  if (!items.length) return <Empty icon={Clock3} title="No tasks yet" text="Create a task when work should plan, run, checkpoint, and report outside a single reply." />;
  return <div className="mt-5 space-y-3">{items.map((m) => { const done = m.tasks.filter((t) => t.status === 'COMPLETED').length; const resumable = ['QUEUED', 'PAUSED', 'BLOCKED'].includes(m.status); return <article key={m.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col sm:flex-row sm:items-center gap-3"><span className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', m.status === 'VERIFIED' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-[var(--surface-elevated)] text-[var(--accent)]')}>{m.status === 'VERIFIED' ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}</span><div className="min-w-0 flex-1"><h2 className="font-semibold text-[14px] truncate">{m.objective}</h2><p className="mt-0.5 text-[12px] text-[var(--fg-muted)]">{m.status} · {done}/{m.tasks.length} steps complete</p></div>{resumable && <button onClick={() => onRun(m.id)} className="btn-ghost h-9 px-3 text-[12px]"><Play size={13} /> Run</button>}</article>; })}</div>;
}
function ResearchEmpty({ onOpen }: { onOpen: () => void }) { return <Empty icon={Telescope} title="Start with a question" text="MetaIoid will show live investigation state and retain only sourced findings from the investigation runtime." action="Open research" onAction={onOpen} />; }
function Empty({ icon: Icon, title, text, action, onAction }: { icon: typeof FolderPlus; title: string; text: string; action?: string; onAction?: () => void }) { return <div className="mt-8 max-w-[520px] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-7 text-center"><span className="mx-auto w-10 h-10 rounded-xl bg-[var(--surface-elevated)] text-[var(--accent)] flex items-center justify-center"><Icon size={18} /></span><h2 className="mt-3 font-semibold text-[15px]">{title}</h2><p className="mt-1 text-[13px] text-[var(--fg-muted)]">{text}</p>{action && <button onClick={onAction} className="btn-primary mt-4 h-9 px-3.5 text-[12.5px]">{action}<ArrowRight size={13} /></button>}</div>; }
