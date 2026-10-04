import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Check, Search, ArrowLeft, RefreshCw } from 'lucide-react';
import { MODELS, modelLabel } from '../lib/i18n';
import {
  fetchProviders, fetchCredentials, fetchProviderModels, fetchRouting, saveRouting,
  type ProviderInfo, type CredentialInfo,
} from '../lib/transport';
import { useApp } from '../lib/store';
import type { ModelId } from '../lib/types';
import { cn } from '../lib/cn';
import { AiSetupModal } from './setup/AiSetupModal';

interface ProviderModel {
  modelId: string;
  displayName: string;
}

/** Local-first providers bill nobody — everything they serve counts as free. */
const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'vllm']);

function isFreeModel(providerId: string, modelId: string): boolean {
  if (LOCAL_PROVIDERS.has(providerId)) return true;
  const id = modelId.toLowerCase();
  return id.endsWith(':free') || id.includes('/free') || id.startsWith('free:');
}

function shortName(modelId: string): string {
  const tail = modelId.split('/').pop() || modelId;
  return tail.replace(/:free$/i, '');
}

// Connected-providers-first picker.
//
// Logic, in order:
//   1. Opens UPWARD (it lives above the composer — opening downward covered
//      the conversation).
//   2. Lists ONLY providers holding one of your keys (plus Auto). No key,
//      no entry — an unusable option is worse than none.
//   3. Tapping a provider swaps the SAME box to its models: FREE section on
//      top, PAID below, each with its title. A search box filters both.
//   4. Picking a model saves it as your default (provider + model) so the
//      router honours it on every later turn; Auto clears it back.
export function ModelSelector({ compact = false }: { compact?: boolean }) {
  const { model, setModel, toast, connection, settings } = useApp();
  const [open, setOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [view, setView] = useState<{ kind: 'providers' } | { kind: 'models'; provider: ProviderInfo }>({ kind: 'providers' });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [creds, setCreds] = useState<CredentialInfo[]>([]);
  const [routing, setRouting] = useState<{ defaultProvider: string | null; defaultModel: string } | null>(null);
  const [models, setModels] = useState<Record<string, ProviderModel[]>>({});
  const [loadingModels, setLoadingModels] = useState(false);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);

  const reachable = connection === 'online' || connection === 'mock' || connection === 'degraded';
  const connectedIds = new Set(creds.filter((c) => c.isActive !== false).map((c) => c.providerId));
  const connected = providers.filter((p) => connectedIds.has(p.providerId));

  const loadBase = async () => {
    try {
      const [ps, cs, r] = await Promise.all([
        fetchProviders(settings.backendUrl),
        fetchCredentials(settings.backendUrl),
        fetchRouting(settings.backendUrl).catch(() => null),
      ]);
      setProviders(ps);
      setCreds(cs);
      if (r) setRouting({ defaultProvider: r.defaultProvider ?? null, defaultModel: r.defaultModel ?? '' });
      setLoaded(true);
    } catch {
      setLoaded(true); // offline/demo: tiers below still work
    }
  };

  useEffect(() => {
    if (open && !loaded) void loadBase();
    if (open) {
      setView({ kind: 'providers' });
      setQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const openProvider = async (p: ProviderInfo) => {
    setView({ kind: 'models', provider: p });
    setQuery('');
    if (models[p.providerId]) return;
    setLoadingModels(true);
    try {
      const list = await fetchProviderModels(settings.backendUrl, p.providerId);
      setModels((prev) => ({ ...prev, [p.providerId]: list }));
    } catch {
      setModels((prev) => ({ ...prev, [p.providerId]: [] }));
    } finally {
      setLoadingModels(false);
    }
  };

  const pickAuto = async () => {
    try {
      await saveRouting(settings.backendUrl, { defaultProvider: null, defaultModel: '' });
      setRouting({ defaultProvider: null, defaultModel: '' });
      toast({ title: 'Routing: Auto. Router picks per task.' });
    } catch {
      toast({ title: 'Could not save routing.' });
    } finally {
      setOpen(false);
    }
  };

  const pickModel = async (providerId: string, modelId: string, display: string) => {
    try {
      await saveRouting(settings.backendUrl, { defaultProvider: providerId, defaultModel: modelId });
      setRouting({ defaultProvider: providerId, defaultModel: modelId });
      toast({ title: `Default: ${display}.` });
    } catch {
      toast({ title: 'Could not save model.' });
    } finally {
      setOpen(false);
    }
  };

  const currentLabel = routing?.defaultModel
    ? shortName(routing.defaultModel)
    : `MetaIoid · ${modelLabel(model)}`;

  const q = query.trim().toLowerCase();
  const viewModels = view.kind === 'models' ? (models[view.provider.providerId] ?? []) : [];
  const shown = q
    ? viewModels.filter((m) => m.modelId.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q))
    : viewModels;
  const free = view.kind === 'models' ? shown.filter((m) => isFreeModel(view.provider.providerId, m.modelId)) : [];
  const paid = view.kind === 'models' ? shown.filter((m) => !isFreeModel(view.provider.providerId, m.modelId)) : [];

  const renderModelRow = (m: ProviderModel, pid: string) => {
    const active = routing?.defaultModel === m.modelId;
    return (
      <button
        key={m.modelId}
        role="option"
        aria-selected={active}
        onClick={() => void pickModel(pid, m.modelId, m.displayName || shortName(m.modelId))}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors',
          active ? 'bg-[var(--surface-hover)] border border-[var(--border)]' : 'hover:bg-[var(--surface-hover)]',
        )}
      >
        <span className="flex-1 min-w-0">
          <span className="block text-ui font-medium text-[var(--fg)] truncate">{m.displayName || shortName(m.modelId)}</span>
          <span className="block text-micro font-mono text-[var(--fg-muted)] truncate">{m.modelId}</span>
        </span>
        {active && <Check size={14} className="text-[var(--accent)] shrink-0" />}
      </button>
    );
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-full text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors',
          compact ? 'h-7 px-2 text-micro' : 'h-8 px-2.5 text-small'
        )}
        aria-haspopup="dialog" aria-expanded={open} aria-label="Select provider and model"
      >
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', reachable ? 'bg-success/10' : 'bg-[var(--fg-subtle)]')} title={reachable ? 'Connected' : 'Local demo'} />
        <span className="font-medium whitespace-nowrap">{currentLabel}</span>
        <ChevronDown size={12} className={cn('text-[var(--fg-muted)] transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 bottom-11 z-50 w-[340px] max-w-[86vw] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg)] shadow-pop p-1.5 max-h-[420px] overflow-y-auto"
              role="dialog" aria-label="Provider and model picker"
            >
              {view.kind === 'providers' ? (
                <>
                  <div className="px-3 pt-2 pb-1.5">
                    <div className="text-small font-medium text-[var(--fg)]">Your AI</div>
                    <div className="text-micro text-[var(--fg-muted)] mt-0.5">
                      {reachable ? 'Only providers holding your key. One activates everything.' : 'No AI connected — local demo replies'}
                    </div>
                  </div>
                  <button
                    onClick={() => void pickAuto()}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors',
                      !routing?.defaultModel ? 'bg-[var(--surface-hover)] border border-[var(--border)]' : 'hover:bg-[var(--surface-hover)]',
                    )}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-ui font-medium text-[var(--fg)]">Auto</span>
                      <span className="block text-micro text-[var(--fg-muted)]">Router picks per task</span>
                    </span>
                    {!routing?.defaultModel && <Check size={14} className="text-[var(--accent)] shrink-0" />}
                  </button>
                  {connected.map((p) => {
                    const isDefault = routing?.defaultProvider === p.providerId && !routing?.defaultModel;
                    return (
                      <button
                        key={p.providerId}
                        onClick={() => void openProvider(p)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors hover:bg-[var(--surface-hover)]"
                      >
                        <span className="h-2 w-2 rounded-full bg-success shrink-0" aria-hidden />
                        <span className="flex-1 min-w-0">
                          <span className="block text-ui font-medium text-[var(--fg)] truncate">{p.name}</span>
                          <span className="block text-micro text-[var(--fg-muted)]">
                            Connected{routing?.defaultModel && routing.defaultProvider === p.providerId ? ' · has your default model' : ''}
                          </span>
                        </span>
                        {isDefault && <Check size={14} className="text-[var(--accent)] shrink-0" />}
                        <span className="text-micro text-[var(--fg-muted)]" aria-hidden>›</span>
                      </button>
                    );
                  })}
                  {reachable && loaded && connected.length === 0 && (
                    <div className="px-3 py-2 text-small text-[var(--fg-muted)]">No provider connected yet — start below.</div>
                  )}
                  {!reachable && (
                    <div className="px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-wider text-[var(--fg-muted)]">Thinking style (demo)</div>
                  )}
                  {!reachable && MODELS.map((m) => {
                    const active = model === m.id;
                    return (
                      <button
                        key={m.id} role="option" aria-selected={active}
                        onClick={() => { setModel(m.id as ModelId); setOpen(false); toast({ title: `Model set to ${m.label}` }); }}
                        className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors', active ? 'bg-[var(--surface-hover)] border border-[var(--border)]' : 'hover:bg-[var(--surface-hover)]')}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-ui font-medium text-[var(--fg)] truncate">{m.label}</span>
                          <span className="block text-micro text-[var(--fg-muted)] truncate">{m.desc}</span>
                        </span>
                        {active && <Check size={14} className="text-[var(--accent)]" />}
                      </button>
                    );
                  })}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 px-1 pt-1">
                    <button
                      onClick={() => { setView({ kind: 'providers' }); setQuery(''); }}
                      className="icon-btn w-8 h-8"
                      aria-label="Back to providers"
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-small font-medium text-[var(--fg)] truncate">{view.provider.name}</div>
                      <div className="text-micro text-[var(--fg-muted)]">Free on top · paid below</div>
                    </div>
                    <button onClick={() => void openProvider(view.provider)} className="icon-btn w-8 h-8" aria-label="Refresh model list">
                      <RefreshCw size={12} />
                    </button>
                  </div>
                  <div className="p-1.5">
                    <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 h-9">
                      <Search size={13} className="text-[var(--fg-muted)] shrink-0" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${view.provider.name} models…`}
                        aria-label="Search models"
                        className="w-full bg-transparent text-small text-[var(--fg)] outline-none placeholder:text-[var(--fg-faint)]"
                      />
                    </label>
                  </div>
                  {loadingModels && !viewModels.length ? (
                    <div className="px-3 py-3 text-small text-[var(--fg-muted)]">Loading models…</div>
                  ) : (
                    <>
                      {free.length > 0 && (
                        <>
                          <div className="px-3 pt-1.5 pb-1 text-micro font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                            Free · {free.length}
                          </div>
                          {free.map((m) => renderModelRow(m, view.provider.providerId))}
                        </>
                      )}
                      {paid.length > 0 && (
                        <>
                          <div className="px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                            Paid · {paid.length}
                          </div>
                          {paid.map((m) => renderModelRow(m, view.provider.providerId))}
                        </>
                      )}
                      {shown.length === 0 && (
                        <div className="px-3 py-3 text-small text-[var(--fg-muted)]">
                          {q ? `No models match “${query}”.` : 'No models listed for this provider yet.'}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              <div className="p-2 border-t border-[var(--border-subtle)] mt-1">
                <button
                  onClick={() => {
                    setOpen(false);
                    setShowSetup(true);
                  }}
                  className="w-full h-8 rounded-lg bg-[var(--surface-hover)] border border-[var(--border)] text-micro font-medium text-[var(--fg)] hover:text-[var(--accent)] transition-all flex items-center justify-center gap-1.5"
                >
                  Discover 50+ Providers & Free AI &rarr;
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {showSetup && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-[620px] max-h-[92vh] overflow-y-auto">
            <AiSetupModal
              canSkip={true}
              onComplete={() => setShowSetup(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
