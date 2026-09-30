import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { SettingsRow, Seg } from './SettingsGroup';
import {
  fetchProviders, fetchProviderModels, refreshProviderModels, fetchProviderHelp,
  fetchCredentials, connectCredential, testCredential, rotateCredential, disconnectCredential,
  fetchRouting, saveRouting, fetchProviderHealth, fetchProviderUsage, fetchModelCatalog,
  type ProviderInfo, type CredentialInfo, type RoutingPrefs,
} from '../lib/transport';
import { cn } from '../lib/cn';

// Settings → AI Providers: connect keys, test health, default/fallback
// routing, rotate/disconnect, usage. Raw secrets never render — the API
// only returns redacted identities.
export function ProviderSettings() {
  const { settings, connection, authUser, toast } = useApp();
  const online = connection === 'online' && !!authUser;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [creds, setCreds] = useState<CredentialInfo[]>([]);
  const [routing, setRouting] = useState<RoutingPrefs | null>(null);
  const [health, setHealth] = useState<Record<string, { status: string; latency?: number }>>({});
  const [usage, setUsage] = useState<Record<string, { requests: number; errors: number; totalTokens: number; avgLatencyMs: number; cost: { usd: number | null; source: string } }>>({});
  const [models, setModels] = useState<Record<string, { modelId: string; displayName: string }[]>>({});
  const [help, setHelp] = useState<Record<string, { keyUrl: string | null; docsUrl: string | null; steps: string[] }>>({});
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState('');
  const [testing, setTesting] = useState<Record<string, { ok: boolean; status: string; latencyMs: number }>>({});

  const load = useCallback(async () => {
    if (!online) return;
    try {
      const [p, c, r, h, u] = await Promise.all([
        fetchProviders(settings.backendUrl),
        fetchCredentials(settings.backendUrl),
        fetchRouting(settings.backendUrl),
        fetchProviderHealth(settings.backendUrl).catch(() => ({})),
        fetchProviderUsage(settings.backendUrl).catch(() => ({})),
      ]);
      setProviders(p.filter((x) => x.adapter));
      setCreds(c);
      setRouting(r);
      setHealth(h);
      setUsage(u);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Could not load providers.' });
    }
  }, [online, settings.backendUrl, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const ensureModels = async (pid: string) => {
    if (models[pid]) return;
    try {
      const m = await fetchProviderModels(settings.backendUrl, pid);
      setModels((prev) => ({ ...prev, [pid]: m }));
    } catch { /* optional */ }
  };

  const ensureHelp = async (pid: string) => {
    if (help[pid]) return;
    try {
      const h = await fetchProviderHelp(settings.backendUrl, pid);
      setHelp((prev) => ({ ...prev, [pid]: h }));
    } catch { /* optional */ }
  };

  if (!online) {
    return <p className="text-[12.5px] text-[var(--fg-muted)]">Sign in with the gateway online to manage AI providers.</p>;
  }

  const credFor = (pid: string) => creds.find((c) => c.providerId === pid);
  const nameOf = (pid: string) => providers.find((p) => p.providerId === pid)?.name ?? pid;
  const connectedCount = providers.filter((p) => credFor(p.providerId)).length;
  const healthOf = (pid: string): { status: string; ms: number | null } | null => {
    const t = testing[pid];
    if (t) return { status: t.status, ms: t.latencyMs ?? null };
    const h = health[pid];
    if (h) return { status: h.status, ms: h.latency ?? null };
    return null;
  };

  const doConnect = async (pid: string, rotate = false) => {
    if (!keyInput.trim()) {
      toast({ title: 'Paste an API key first.' });
      return;
    }
    setBusy(`${pid}:save`);
    try {
      if (rotate) {
        const c = credFor(pid);
        if (c) await rotateCredential(settings.backendUrl, c.id, keyInput.trim());
      } else {
        await connectCredential(settings.backendUrl, pid, keyInput.trim());
      }
      setKeyInput('');
      setOpenForm(null);
      toast({ title: rotate ? 'Key replaced.' : 'Provider connected. Testing…' });
      await load();
      const c2 = (await fetchCredentials(settings.backendUrl)).find((x) => x.providerId === pid);
      if (c2) await doTest(pid, c2.id);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Connect failed.', tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const doTest = async (pid: string, cid?: string) => {
    const c = cid || credFor(pid)?.id;
    if (!c) return;
    setBusy(`${pid}:test`);
    try {
      const r = await testCredential(settings.backendUrl, c);
      setTesting((prev) => ({ ...prev, [pid]: r }));
      toast({ title: r.ok ? `${nameOf(pid)} is working (${r.latencyMs}ms).` : `${nameOf(pid)}: ${r.status}.`, tone: r.ok ? 'success' : 'error' });
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Test failed.', tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const setDefault = async (pid: string | null) => {
    try {
      setRouting(await saveRouting(settings.backendUrl, { defaultProvider: pid }));
      toast({ title: pid ? `Default: ${nameOf(pid)}.` : 'Routing: Auto.' });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Save failed.', tone: 'error' });
    }
  };

  const toggleFallback = async (pid: string) => {
    if (!routing) return;
    const has = routing.fallbackProviders.includes(pid);
    const next = has ? routing.fallbackProviders.filter((x) => x !== pid) : [...routing.fallbackProviders, pid];
    try {
      setRouting(await saveRouting(settings.backendUrl, { fallbackProviders: next }));
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Save failed.', tone: 'error' });
    }
  };

  // ---- one-key onboarding: no keys yet ----
  if (providers.length > 0 && connectedCount === 0) {
    return <OnboardingCard providers={providers} help={help} ensureHelp={ensureHelp} onDone={load} />;
  }

  return (
    <div>
      <SettingsRow
        label="Routing"
        hint="Auto uses your default, then fallbacks, then any healthy provider"
        control={
          <Seg
            options={['auto', ...providers.map((p) => p.providerId)] as unknown as string[]}
            value={(routing?.defaultProvider || 'auto') as string}
            onPick={(v) => setDefault(v === 'auto' ? null : v)}
            label="Default provider"
          />
        }
      />
      {providers.map((p) => {
        const cred = credFor(p.providerId);
        const hs = healthOf(p.providerId);
        const u = usage[p.providerId];
        const isDefault = routing?.defaultProvider === p.providerId;
        const isFallback = routing?.fallbackProviders.includes(p.providerId);
        const expanded = openForm === p.providerId;
        return (
          <div key={p.providerId} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3.5 mt-2.5">
            <div className="flex items-center gap-2.5">
              <span className={cn('h-2 w-2 rounded-full shrink-0', !cred ? 'bg-zinc-500' : !hs ? 'bg-zinc-400' : hs.status === 'healthy' ? 'bg-emerald-400' : 'bg-amber-300')} />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[var(--fg)]">
                  {p.name}
                  {isDefault && <span className="ml-2 text-[10.5px] font-bold uppercase text-[var(--accent)]">Default</span>}
                  {isFallback && !isDefault && <span className="ml-2 text-[10.5px] font-bold uppercase text-[var(--fg-muted)]">Fallback</span>}
                </p>
                <p className="text-[12px] text-[var(--fg-muted)]">
                  {cred ? `Connected · ${cred.redacted || 'key stored'}` : 'Not connected'}
                  {hs && cred ? ` · ${hs.status}${hs.ms !== null ? ` · ${hs.ms}ms` : ''}` : ''}
                  {u ? ` · ${u.requests} req · ${u.totalTokens} tok` : ''}
                </p>
                <p className="text-[11.5px] text-[var(--fg-faint)]">
                  {(p.capabilities.supportedModalities || []).join(' · ') || p.category}
                  {u ? ` · cost: ${u.cost.usd === null ? 'not reported by provider' : `$${u.cost.usd.toFixed(4)} reported`}` : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {!cred ? (
                <PanelBtn label="Connect" onClick={() => { setOpenForm(expanded ? null : p.providerId); setKeyInput(''); ensureHelp(p.providerId); }} />
              ) : (
                <>
                  <PanelBtn label="Test" busy={busy === `${p.providerId}:test`} onClick={() => doTest(p.providerId)} />
                  {!isDefault && <PanelBtn label="Set Default" onClick={() => setDefault(p.providerId)} />}
                  {isDefault && <PanelBtn label="Auto" onClick={() => setDefault(null)} />}
                  <PanelBtn label={isFallback ? 'Remove fallback' : 'Fallback'} onClick={() => toggleFallback(p.providerId)} />
                  <PanelBtn label="Models" onClick={() => { ensureModels(p.providerId); setOpenForm(expanded ? null : `${p.providerId}:models`); }} />
                  <PanelBtn label="Replace key" onClick={() => { setOpenForm(expanded ? null : p.providerId); setKeyInput(''); ensureHelp(p.providerId); }} />
                  <PanelBtn label="Disconnect" danger onClick={async () => {
                    setBusy(`${p.providerId}:del`);
                    try {
                      await disconnectCredential(settings.backendUrl, cred.id);
                      toast({ title: `${p.name} disconnected.` });
                      load();
                    } catch (e) {
                      toast({ title: e instanceof Error ? e.message : 'Disconnect failed.', tone: 'error' });
                    } finally {
                      setBusy('');
                    }
                  }} />
                </>
              )}
            </div>
            {expanded && !openForm.endsWith(':models') && (
              <KeyForm
                providerId={p.providerId}
                help={help[p.providerId]}
                keyInput={keyInput}
                setKeyInput={setKeyInput}
                busy={busy === `${p.providerId}:save`}
                rotate={!!cred}
                onSave={() => doConnect(p.providerId, !!cred)}
              />
            )}
            {expanded && openForm.endsWith(':models') && (
              <ModelPicker
                providerId={p.providerId}
                models={models[p.providerId] || []}
                routing={routing}
                onPick={async (mid) => {
                  try {
                    setRouting(await saveRouting(settings.backendUrl, { defaultModel: mid, defaultProvider: p.providerId }));
                    toast({ title: `Default model: ${mid}.` });
                  } catch (e) {
                    toast({ title: e instanceof Error ? e.message : 'Save failed.', tone: 'error' });
                  }
                }}
                onRefresh={async () => {
                  try {
                    const r = await refreshProviderModels(settings.backendUrl, p.providerId);
                    const m = await fetchProviderModels(settings.backendUrl, p.providerId);
                    setModels((prev) => ({ ...prev, [p.providerId]: m }));
                    toast({ title: `Models updated (${r.count}${r.live ? ', live list' : ''}).` });
                  } catch (e) {
                    toast({ title: e instanceof Error ? e.message : 'Update failed.', tone: 'error' });
                  }
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PanelBtn({ label, onClick, danger, busy }: { label: string; onClick: () => void; danger?: boolean; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={!!busy}
      className={cn(
        'h-8 px-2.5 rounded-lg border text-[12px] font-medium disabled:opacity-50',
        danger
          ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
          : 'border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
      )}
    >
      {busy ? '…' : label}
    </button>
  );
}

function KeyForm({ providerId, help, keyInput, setKeyInput, busy, rotate, onSave }: {
  providerId: string;
  help?: { keyUrl: string | null; docsUrl: string | null; steps: string[] };
  keyInput: string;
  setKeyInput: (v: string) => void;
  busy: boolean;
  rotate: boolean;
  onSave: () => void;
}) {
  return (
    <div className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] p-3">
      <p className="text-[12px] font-medium text-[var(--fg-muted)]">API Key</p>
      {help?.keyUrl && (
        <a href={help.keyUrl} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--accent)] hover:underline">
          Get API key →
        </a>
      )}
      <input
        type="password"
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
        }}
        placeholder="Paste key — stored encrypted, never shown again"
        className="mt-1.5 h-10 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3 font-mono text-[13px] outline-none"
        aria-label={`${providerId} API key`}
      />
      <button
        onClick={onSave}
        disabled={busy || !keyInput.trim()}
        className="mt-2 h-9 w-full rounded-xl bg-[var(--accent)] text-white text-[13px] font-semibold disabled:opacity-50"
      >
        {busy ? 'Saving…' : rotate ? 'Rotate key' : 'Connect'}
      </button>
    </div>
  );
}

function ModelPicker({ providerId, models, routing, onPick, onRefresh }: {
  providerId: string;
  models: { modelId: string; displayName: string }[];
  routing: RoutingPrefs | null;
  onPick: (mid: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] p-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[12px] font-medium text-[var(--fg-muted)] flex-1">Default model for {providerId}</p>
        <button onClick={onRefresh} className="text-[12px] text-[var(--accent)] hover:underline">Update models</button>
      </div>
      {!models.length && <p className="text-[12px] text-[var(--fg-faint)]">No models cached — press Sync catalog.</p>}
      <div className="space-y-1">
        {models.map((m) => (
          <button
            key={m.modelId}
            onClick={() => onPick(m.modelId)}
            className={cn(
              'w-full text-left px-2.5 py-1.5 rounded-lg text-[12.5px] font-mono hover:bg-[var(--surface-elevated)]',
              routing?.defaultModel === m.modelId ? 'text-[var(--accent)] font-semibold' : 'text-[var(--fg)]'
            )}
          >
            {routing?.defaultModel === m.modelId ? '● ' : '○ '}{m.displayName || m.modelId}
          </button>
        ))}
      </div>
    </div>
  );
}

function OnboardingCard({ providers, help, ensureHelp, onDone }: {
  providers: { providerId: string; name: string }[];
  help: Record<string, { keyUrl: string | null; docsUrl: string | null; steps: string[] }>;
  ensureHelp: (pid: string) => void;
  onDone: () => void;
}) {
  const { settings, toast } = useApp();
  const [pid, setPid] = useState(providers[0]?.providerId || 'openai');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const h = help[pid];
  useEffect(() => {
    ensureHelp(pid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);
  return (
    <div className="rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] p-4">
      <p className="text-[14px] font-bold text-[var(--fg)]">Connect your first AI provider.</p>
      <p className="text-[12.5px] text-[var(--fg-muted)] mt-0.5">Choose an LLM → paste key → test → ready. Nothing else needed.</p>
      <div className="flex gap-1.5 mt-3 flex-wrap">
        {providers.filter((p) => ['openai', 'anthropic', 'gemini', 'openrouter'].includes(p.providerId)).map((p) => (
          <button
            key={p.providerId}
            onClick={() => setPid(p.providerId)}
            className={cn('h-9 px-3.5 rounded-xl border text-[13px] font-medium', pid === p.providerId ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-muted)]')}
          >
            {p.name}
          </button>
        ))}
      </div>
      {h?.keyUrl && (
        <a href={h.keyUrl} target="_blank" rel="noreferrer" className="inline-block mt-2.5 text-[13px] text-[var(--accent)] hover:underline">
          Get API key →
        </a>
      )}
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && key.trim() && !busy) {
            setBusy(true);
            (async () => {
              try {
                const c = await connectCredential(settings.backendUrl, pid, key.trim());
                const t = await testCredential(settings.backendUrl, c.id);
                if (!t.ok) throw new Error(`Connection test: ${t.status}.`);
                toast({ title: `${providers.find((p) => p.providerId === pid)?.name ?? pid} is ready.` });
                onDone();
              } catch (err) {
                toast({ title: err instanceof Error ? err.message : 'Connect failed.', tone: 'error' });
                setBusy(false);
              }
            })();
          }
        }}
        placeholder="Paste API key"
        className="mt-2 h-11 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3.5 font-mono text-[13.5px] outline-none"
        aria-label="API key"
      />
      <button
        disabled={busy || !key.trim()}
        onClick={() => {
          setBusy(true);
          (async () => {
            try {
              const c = await connectCredential(settings.backendUrl, pid, key.trim());
              const t = await testCredential(settings.backendUrl, c.id);
              if (!t.ok) throw new Error(`Connection test: ${t.status}.`);
              toast({ title: `${providers.find((p) => p.providerId === pid)?.name ?? pid} is ready.` });
              onDone();
            } catch (err) {
              toast({ title: err instanceof Error ? err.message : 'Connect failed.', tone: 'error' });
              setBusy(false);
            }
          })();
        }}
        className="mt-2.5 h-11 w-full rounded-xl bg-[var(--accent)] text-white text-[14px] font-semibold disabled:opacity-50"
      >
        {busy ? 'Testing key…' : 'Connect & Test'}
      </button>
    </div>
  );
}
