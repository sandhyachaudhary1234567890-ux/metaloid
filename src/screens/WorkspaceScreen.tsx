import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Clock3, FolderPlus, Loader2, Play, Plus, RefreshCw, Search, Telescope } from 'lucide-react';
import { useApp } from '../lib/store';
import {
  createWorkspace, fetchArtifacts, fetchWorkspaces, missionList, missionRun,
  type ArtifactMeta, type Mission, type Workspace,
} from '../lib/transport';
import { ArtifactCard } from '../components/ArtifactCard';
import { EmptyState } from '../components/ui/EmptyState';
import { LocalWork } from '../components/workspaces/LocalWork';
import type { ArtKey } from '../design/assets';
import { cn } from '../lib/cn';

// WORKSPACES — Projects · Library · Research · Tasks.
//
// Four destinations that share one shape: a title, one honest sentence about
// what will appear, a search field, and either the data or an art-directed
// empty state. Empty states in this file previously rendered a grey icon in a
// bordered box; they are now a piece from the product's visual library.

type ScreenKind = 'projects' | 'library' | 'research' | 'tasks';

const COPY: Record<ScreenKind, { title: string; subtitle: string; art: ArtKey }> = {
  projects: {
    title: 'Projects',
    subtitle: 'Persistent workspaces with their own instructions, files and artifacts.',
    art: 'projects',
  },
  library: {
    title: 'Library',
    subtitle: 'Documents, decks and files MetaIoid has made. Nothing appears here until it exists.',
    art: 'files',
  },
  research: {
    title: 'Research',
    subtitle: 'Cited investigations you can keep, revisit and build on.',
    art: 'sources',
  },
  tasks: {
    title: 'Tasks',
    subtitle: 'Long-running work that plans, checkpoints and reports outside a single reply.',
    art: 'memory',
  },
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
  const copy = COPY[kind];

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

  return (
    <div className="mx-auto max-w-[1080px] px-4 pb-32 pt-8 sm:px-8 md:pb-16">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="t-display text-[var(--fg)]">{copy.title}</h1>
          <p className="mt-1.5 max-w-[62ch] text-body text-[var(--fg-muted)] text-pretty">{copy.subtitle}</p>
        </div>

        {kind === 'projects' && (
          <button disabled={!online || creating} onClick={askProjectName} className="btn-primary h-9 shrink-0 gap-1.5 px-3.5 text-ui">
            <FolderPlus size={15} strokeWidth={1.8} />
            {creating ? 'Creating…' : 'New project'}
          </button>
        )}
        {kind === 'research' && (
          <button disabled={!online} onClick={() => { setOsintTarget(''); setOsintOpen(true); }} className="btn-primary h-9 shrink-0 gap-1.5 px-3.5 text-ui">
            <Telescope size={15} strokeWidth={1.8} />
            New investigation
          </button>
        )}
        {kind === 'tasks' && (
          <button disabled={!online} onClick={() => { setMissionDraft(''); setMissionsOpen(true); }} className="btn-primary h-9 shrink-0 gap-1.5 px-3.5 text-ui">
            <Plus size={15} strokeWidth={1.8} />
            New task
          </button>
        )}
      </header>

      {/* Unfinished work this device still holds. It is the one thing in the
          workspace that does not need the gateway, so it shows either way. */}
      {kind === 'tasks' && <LocalWork />}

      {!online ? (
        <EmptyState
          art="unavailable"
          title={kind === 'tasks' ? 'Gateway tasks need the gateway' : `${copy.title} needs the gateway`}
          description={
            kind === 'tasks'
              ? 'Work you started in chat is listed above and survives a reload. Gateway tasks need a connection.'
              : 'This workspace reads live data, so nothing is shown while the local demo is running. Connect a gateway in Settings to see it.'
          }
          action={
            <span className="flex items-center gap-2">
              <button onClick={() => { setOsintTarget(''); setOsintOpen(true); }} className="btn-ghost h-9 px-3.5 text-ui">
                Try anyway
              </button>
            </span>
          }
        />
      ) : kind === 'research' ? (
        <EmptyState
          art="sources"
          title="Start with a question"
          description="MetaIoid shows its sources as it works, and keeps only what it could verify."
          action={
            <button onClick={() => { setOsintTarget(''); setOsintOpen(true); }} className="btn-primary h-9 gap-1.5 px-3.5 text-ui">
              <Telescope size={14} strokeWidth={1.8} />
              Open research
            </button>
          }
        />
      ) : (
        <>
          <div className="mt-6 flex gap-2">
            <label className="input-shell flex h-10 flex-1 items-center gap-2.5 px-3">
              <Search size={15} className="shrink-0 text-[var(--fg-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-ui text-[var(--fg)] outline-none"
                placeholder={`Search ${copy.title.toLowerCase()}…`}
                aria-label={`Search ${copy.title.toLowerCase()}`}
              />
            </label>
            <button onClick={() => void refresh()} className="icon-btn h-10 w-10" title="Refresh" aria-label="Refresh">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {error && (
            <div role="alert" className="mt-4 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] px-4 py-3 text-ui text-[var(--fg)]">
              {error}
            </div>
          )}

          {loading ? (
            <div className="mt-10 flex items-center gap-2.5 text-ui text-[var(--fg-muted)]">
              <Loader2 size={15} className="animate-spin" />
              Loading…
            </div>
          ) : kind === 'projects' ? (
            <Projects items={filteredProjects} onCreate={askProjectName} art={copy.art} />
          ) : kind === 'library' ? (
            <LibraryItems items={filteredArtifacts} art={copy.art} />
          ) : (
            <Tasks items={filteredMissions} onRun={runMission} art={copy.art} />
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Collections
   ───────────────────────────────────────────────────────────────────────────── */

function Projects({ items, onCreate, art }: { items: Workspace[]; onCreate: () => void; art: ArtKey }) {
  if (!items.length) {
    return (
      <EmptyState
        art={art}
        title="No projects yet"
        description="Start a workspace for something you're building. Its instructions stay scoped to that project."
        action={
          <button onClick={onCreate} className="btn-primary h-9 gap-1.5 px-3.5 text-ui">
            <FolderPlus size={14} strokeWidth={1.8} />
            Create project
          </button>
        }
      />
    );
  }

  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((p) => (
        <article key={p.id} className="surface-interactive group p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-subtle)] text-[var(--accent)]">
              <Archive size={16} strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-ui font-medium text-[var(--fg)]">{p.name}</h2>
              <p className="mt-0.5 text-small capitalize text-[var(--fg-muted)]">
                {p.kind} · updated {new Date(p.updatedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <p className="mt-3 line-clamp-2 min-h-9 text-small text-[var(--fg-muted)]">
            {p.instructions || 'No project instructions yet.'}
          </p>
          <p className="mt-3 text-small text-[var(--fg-subtle)]">
            {p.files.length} attached file{p.files.length === 1 ? '' : 's'}
          </p>
        </article>
      ))}
    </div>
  );
}

function LibraryItems({ items, art }: { items: ArtifactMeta[]; art: ArtKey }) {
  if (!items.length) {
    return (
      <EmptyState
        art={art}
        title="Your library is empty"
        description="Documents, decks and files appear here once MetaIoid has finished making them."
      />
    );
  }
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {items.map((a) => <ArtifactCard key={a.id} artifact={a} />)}
    </div>
  );
}

function Tasks({ items, onRun, art }: { items: Mission[]; onRun: (id: string) => void; art: ArtKey }) {
  if (!items.length) {
    return (
      <EmptyState
        art={art}
        title="No tasks yet"
        description="Create a task when work should plan, run, checkpoint and report outside a single reply."
      />
    );
  }

  return (
    <div className="mt-5 space-y-2.5">
      {items.map((m) => {
        const done = m.tasks.filter((t) => t.status === 'COMPLETED').length;
        const resumable = ['QUEUED', 'PAUSED', 'BLOCKED'].includes(m.status);
        const verified = m.status === 'VERIFIED';
        return (
          <article key={m.id} className="surface-interactive flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]',
                verified ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'bg-[var(--surface-elevated)] text-[var(--fg-muted)]',
              )}
            >
              {verified ? <CheckCircle2 size={16} strokeWidth={1.8} /> : <Clock3 size={16} strokeWidth={1.8} />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-ui font-medium text-[var(--fg)]">{m.objective}</h2>
              <p className="mt-0.5 text-small text-[var(--fg-muted)]">
                {m.status.toLowerCase()} · {done}/{m.tasks.length} steps complete
              </p>
            </div>
            {resumable && (
              <button onClick={() => onRun(m.id)} className="btn-ghost h-9 shrink-0 gap-1.5 px-3.5 text-ui">
                <Play size={13} strokeWidth={1.8} />
                Run
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
