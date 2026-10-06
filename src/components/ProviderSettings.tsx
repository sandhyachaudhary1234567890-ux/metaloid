import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { SettingsRow, Seg } from './SettingsGroup';
import {
  fetchProviders, fetchProviderModels, refreshProviderModels, fetchProviderHelp,
  fetchCredentials, connectCredential, testCredential, rotateCredential, disconnectCredential,
  fetchRouting, saveRouting, fetchProviderHealth, fetchProviderUsage,
  saveDefaultRoute, normalizeApiKey, detectProviderFromKey,
  type ProviderInfo, type CredentialInfo, type RoutingPrefs,
} from '../lib/transport';
import { cn } from '../lib/cn';

import { AiSetupModal } from './setup/AiSetupModal';
import { Sparkles, Check, AlertCircle, Loader2, ExternalLink, ShieldCheck } from 'lucide-react';

// Settings → AI → AI Connections.
//
// The BYOK flow in one place, shaped around what actually goes wrong when a
// person connects a key:
//
//   1. They open the wrong provider (a `sk-or-` key pasted into OpenAI). The
//      paste is inspected and the matching provider is offered in one tap.
//   2. They paste a key with a newline / quotes / "Bearer " attached. It is
//      normalised BEFORE it is stored, so the provider sees the real key.
//   3. They are told "connected" and then get a demo reply. Verification is a
//      real provider call, its result is shown inline (and kept), and the
//      connection state is refreshed immediately after it passes.
//   4. The choice never reaches the model router. The default provider/model
//      is written to both stores the router reads, from this screen.

const PREFERRED_ORDER = ['openrouter', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'mistral', 'cerebras', 'together', 'ollama', 'lmstudio'];
const orderOf = (pid: string) => {
  const i = PREFERRED_ORDER.indexOf(pid);
  return i === -1 ? PREFERRED_ORDER.length : i;
};

const FREE_NOTE: Record<string, string> = {
  openrouter: 'Free models included — a card is not required.',
  gemini: 'Google AI Studio keys have a free tier.',
  groq: 'Groq has a free tier for chat models.',
  cerebras: 'Cerebras has a free developer tier.',
  ollama: 'Runs on your machine — no key required.',
  lmstudio: 'Runs on your machine — no key required.',
};

export function ProviderSettings() {
  const { settings, connection, health, authUser, toast, recheckConnection } = useApp();
  const auth = useAuth();
  // Managing keys needs a gateway that can answer, and an identity to store
  // them under. Those are two different problems and get two different
  // sentences below.
  const gatewayReachable = !!health?.server || connection === 'online' || connection === 'mock' || connection === 'degraded';
  // A self-hosted gateway with no auth service stores the key under its
  // local owner (local-open mode) and needs no account — the same rule the
  // setup checklist already uses. Requiring a session there left a perfectly
  // usable single-user deployment with no way to connect a key at all.
  const signedIn = !!authUser || !auth.configured;
  const canManage = signedIn && gatewayReachable;

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [creds, setCreds] = useState<CredentialInfo[]>([]);
  const [routing, setRouting] = useState<RoutingPrefs | null>(null);
  const [healthMap, setHealthMap] = useState<Record<string, { status: string; latency?: number }>>({});
  const [usage, setUsage] = useState<Record<string, { requests: number; errors: number; totalTokens: number; avgLatencyMs: number; cost: { usd: number | null; source: string } }>>({});
  const [models, setModels] = useState<Record<string, { modelId: string; displayName: string }[]>>({});
  const [help, setHelp] = useState<Record<string, { keyUrl: string | null; docsUrl: string | null; steps: string[] }>>({});
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState('');
  const [testing, setTesting] = useState<Record<string, { ok: boolean; status: string; latencyMs: number; detail?: string; error?: string | null }>>({});
  const [formNote, setFormNote] = useState<{ tone: 'ok' | 'bad' | 'warn' | 'busy'; text: string } | null>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [loadError, setLoadError] = useState('');
  // Stored keys the server can no longer decrypt (the encryption key changed,
  // or the key was saved while the server had an ephemeral one). They must be
  // visible as a broken state with one action — replace — not as "connected".
  const unreadable = health?.byokUnreadable ?? [];
  const rejectedByProvider = health?.byokRejected ?? [];

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoadError('');
    try {
      const [p, c, r, h, u] = await Promise.all([
        fetchProviders(settings.backendUrl),
        fetchCredentials(settings.backendUrl),
        fetchRouting(settings.backendUrl).catch(() => null),
        fetchProviderHealth(settings.backendUrl).catch(() => ({})),
        fetchProviderUsage(settings.backendUrl).catch(() => ({})),
      ]);
      setProviders(p.filter((x) => x.adapter));
      setCreds(c);
      if (r) setRouting(r);
      setHealthMap(h);
      setUsage(u);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load providers.');
    }
  }, [canManage, settings.backendUrl]);

  useEffect(() => { load(); }, [load]);

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

  const ordered = useMemo(
    () => [...providers].sort((a, b) => orderOf(a.providerId) - orderOf(b.providerId) || a.name.localeCompare(b.name)),
    [providers],
  );

  const credFor = (pid: string) => creds.find((c) => c.providerId === pid);
  const nameOf = (pid: string) => providers.find((p) => p.providerId === pid)?.name ?? pid;
  const connectedCount = ordered.filter((p) => credFor(p.providerId)).length;
  const verifiedCount = Object.values(testing).filter((t) => t.ok).length;
  const brokenCount = ordered.filter((p) => unreadable.includes(p.providerId) || rejectedByProvider.includes(p.providerId) || credFor(p.providerId)?.status === 'invalid').length;

  const statusOf = (pid: string): { label: string; tone: 'ok' | 'bad' | 'warn' | 'muted' } => {
    const cred = credFor(pid);
    const t = testing[pid];
    if (t) return { label: t.ok ? `Live — verified${t.latencyMs ? ` in ${t.latencyMs}ms` : ''}` : (t.detail || t.error || t.status || 'Verification failed'), tone: t.ok ? 'ok' : 'bad' };
    if (unreadable.includes(pid)) return { label: 'Saved key can’t be decrypted — replace it', tone: 'bad' };
    if (rejectedByProvider.includes(pid)) return { label: 'Key rejected — replace it', tone: 'bad' };
    if (!cred) return { label: 'Not connected', tone: 'muted' };
    if ((health?.byokProviders ?? []).includes(pid)) return { label: 'Live — answers your chat', tone: 'ok' };
    if (cred.status === 'invalid') return { label: 'Key rejected — replace it', tone: 'bad' };
    if (cred.status === 'connected') return { label: 'Connected · verified', tone: 'ok' };
    return { label: 'Key stored — test to verify', tone: 'warn' };
  };

  const doConnect = async (pid: string, rotate = false) => {
    const key = normalizeApiKey(keyInput);
    if (!key) {
      setFormNote({ tone: 'bad', text: 'Paste an API key first.' });
      return;
    }
    setBusy(`${pid}:save`);
    setFormNote({ tone: 'busy', text: 'Saving to your encrypted vault…' });
    try {
      let cid: string | undefined;
      let ephemeralKey = false;
      if (rotate) {
        const c = credFor(pid);
        if (c) {
          await rotateCredential(settings.backendUrl, c.id, key);
          cid = c.id;
        }
      }
      if (!cid) {
        const created = await connectCredential(settings.backendUrl, pid, key);
        cid = created.id;
        ephemeralKey = created.credential_key === 'ephemeral';
      }
      setKeyInput('');
      setFormNote({ tone: 'busy', text: 'Saved. Asking the provider to verify this key…' });

      // Verify with a real provider call before claiming anything. A stored
      // key that was never proven is exactly how "connected" became a lie.
      const t = await testCredential(settings.backendUrl, cid);
      setTesting((prev) => ({ ...prev, [pid]: t }));
      await load();
      if (t.ok) {
        // Make this provider the router's default and re-read connection state
        // so the app leaves "demo/offline" the moment a key works.
        await saveDefaultRoute(settings.backendUrl, { provider: pid }).catch(() => {});
        setFormNote({ tone: 'ok', text: `Verified. ${nameOf(pid)} will answer your chat.` });
        toast({ title: `${nameOf(pid)} connected and verified.`, desc: t.detail || undefined });
        if (ephemeralKey) {
          // Keep the form open so this is actually read: the key works now but
          // will not survive a server restart until the operator sets a key.
          setFormNote({
            tone: 'warn',
            text: 'Connected — but this server has no stable encryption key (METALOID_CREDENTIAL_KEY), so the saved key stops working after a restart. Ask whoever runs MetaIoid to set it.',
          });
        } else {
          setOpenForm(null);
        }
        await recheckConnection();
      } else {
        setFormNote({ tone: 'bad', text: t.detail || `The provider did not accept this key (${t.status}).` });
        toast({ title: 'Key stored, but the provider rejected it.', desc: t.detail || undefined, tone: 'error' });
      }
    } catch (e) {
      setFormNote({ tone: 'bad', text: e instanceof Error ? e.message : 'Connect failed.' });
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
      toast({ title: r.ok ? `${nameOf(pid)} verified (${r.latencyMs}ms).` : `${nameOf(pid)}: ${r.detail || r.status}`, tone: r.ok ? 'success' : 'error' });
      if (r.ok) await recheckConnection();
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
      if (pid) await saveDefaultRoute(settings.backendUrl, { provider: pid }).catch(() => {});
      toast({ title: pid ? `${nameOf(pid)} is now the default.` : 'Routing: Auto.' });
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

  // ---- states that are NOT "no key yet" ----------------------------------
  if (!signedIn) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3.5 text-small text-[var(--fg-muted)] leading-relaxed">
        Sign in to connect an AI provider. Keys are stored encrypted on the server and never returned to the browser.
      </div>
    );
  }
  if (!gatewayReachable) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3.5">
        <p className="text-small text-[var(--fg-muted)] leading-relaxed">
          The gateway is unreachable, so keys cannot be stored or verified right now. Anything already connected still answers as soon as it comes back.
        </p>
        <button onClick={() => recheckConnection()} className="btn-ghost h-8 px-3 text-small mt-2">Recheck connection</button>
      </div>
    );
  }

  // ---- one-key onboarding: no keys yet -----------------------------------
  if (providers.length > 0 && connectedCount === 0) {
    return <OnboardingCard providers={ordered} help={help} ensureHelp={ensureHelp} onDone={async () => { await load(); await recheckConnection(); }} />;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-read font-semibold text-[var(--fg)]">AI Connections</h3>
          <p className="text-small text-[var(--fg-muted)]">
            {connectedCount
              ? `${connectedCount} connected${verifiedCount ? ` · ${verifiedCount} verified this session` : ''}${brokenCount ? ` · ${brokenCount} needs replacing` : ''} — chat uses your key first.`
              : 'Connect a key or a local model. Chat uses it before anything shared.'}
          </p>
        </div>
        <button
          onClick={() => setShowDiscovery(true)}
          className="btn-primary h-9 px-3.5 text-small flex items-center gap-1.5 shrink-0"
        >
          <Sparkles size={14} /> Discover 50+ Providers
        </button>
      </div>

      {loadError && (
        <p className="mb-3 flex items-center gap-2 text-small text-danger"><AlertCircle size={14} /> {loadError}</p>
      )}

      {brokenCount > 0 && (
        <div className="mb-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3.5 py-3">
          <p className="flex items-center gap-2 text-small font-medium text-[var(--fg)]">
            <AlertCircle size={14} className="text-warning shrink-0" />
            {unreadable.length
              ? `Replace your ${unreadable.join(', ')} key`
              : `Replace your ${rejectedByProvider.join(', ')} key`}
          </p>
          <p className="mt-1 text-small text-[var(--fg-muted)] text-pretty">
            {unreadable.length
              ? 'The saved key can no longer be decrypted on this server, so it cannot answer for you. Paste it again below (or disconnect it) — nothing else about your setup changes.'
              : 'The provider rejected the saved key, so it is skipped when answering. Paste a working key below (or disconnect it).'}
          </p>
        </div>
      )}

      {showDiscovery && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-[620px] max-h-[92vh] overflow-y-auto">
            <AiSetupModal
              canSkip={true}
              onComplete={() => { setShowDiscovery(false); load(); void recheckConnection(); }}
            />
          </div>
        </div>
      )}

      <SettingsRow
        label="Routing"
        hint="Auto uses your default, then fallbacks, then any healthy provider"
        stacked
        control={
          <Seg
            wrap
            options={['auto', ...ordered.map((p) => p.providerId)] as unknown as string[]}
            value={(routing?.defaultProvider || 'auto') as string}
            onPick={(v) => setDefault(v === 'auto' ? null : v)}
            label="Default provider"
          />
        }
      />

      {ordered.map((p) => {
        const cred = credFor(p.providerId);
        const st = statusOf(p.providerId);
        const u = usage[p.providerId];
        const isDefault = routing?.defaultProvider === p.providerId;
        const isFallback = routing?.fallbackProviders.includes(p.providerId);
        // Stored, but not usable: unreadable (server key changed), rejected by
        // the provider, or still on disk with a failed verdict. All three lead
        // to the same action, so they share one flag.
        const broken = unreadable.includes(p.providerId) || rejectedByProvider.includes(p.providerId) || cred?.status === 'invalid';
        const expanded = openForm === p.providerId;
        const formBusy = busy.startsWith(`${p.providerId}:`);
        const detected = detectProviderFromKey(keyInput);
        const wrongProvider = detected && detected !== p.providerId && expanded;
        return (
          <div key={p.providerId} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-elevated)] p-3.5 mt-2.5">
            <div className="flex items-start gap-2.5">
              <span
                className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0',
                  st.tone === 'ok' ? 'bg-success' : st.tone === 'bad' ? 'bg-danger' : st.tone === 'warn' ? 'bg-warning' : 'bg-[var(--fg-subtle)]')}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold text-[var(--fg)]">
                  {p.name}
                  {isDefault && <span className="ml-2 text-micro font-semibold uppercase text-[var(--accent)]">Default</span>}
                  {isFallback && !isDefault && <span className="ml-2 text-micro font-semibold uppercase text-[var(--fg-muted)]">Fallback</span>}
                </p>
                <p className={cn('text-small', st.tone === 'bad' ? 'text-danger' : st.tone === 'ok' ? 'text-success' : 'text-[var(--fg-muted)]')}>
                  {cred ? `${cred.redacted || 'key stored'} · ` : ''}{st.label}
                  {u ? ` · ${u.requests} req · ${u.totalTokens} tok` : ''}
                </p>
                <p className="text-micro text-[var(--fg-faint)]">
                  {FREE_NOTE[p.providerId] || ((p.capabilities.supportedModalities || []).join(' · ') || p.category)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {!cred ? (
                <PanelBtn
                  label={expanded ? 'Cancel' : 'Connect'}
                  onClick={() => {
                    setOpenForm(expanded ? null : p.providerId);
                    setKeyInput('');
                    setFormNote(null);
                    ensureHelp(p.providerId);
                  }}
                />
              ) : (
                <>
                  {broken && <PanelBtn label="Replace key" onClick={() => { setOpenForm(p.providerId); setKeyInput(''); setFormNote(null); ensureHelp(p.providerId); }} />}
                  <PanelBtn label="Test" busy={busy === `${p.providerId}:test`} onClick={() => doTest(p.providerId)} />
                  {!isDefault && <PanelBtn label="Set default" onClick={() => setDefault(p.providerId)} />}
                  <PanelBtn label={isFallback ? 'Remove fallback' : 'Fallback'} onClick={() => toggleFallback(p.providerId)} />
                  <PanelBtn label="Models" onClick={() => { ensureModels(p.providerId); setOpenForm(expanded ? null : `${p.providerId}:models`); }} />
                  {!broken && (
                    <PanelBtn
                      label="Replace key"
                      onClick={() => { setOpenForm(expanded ? null : p.providerId); setKeyInput(''); setFormNote(null); ensureHelp(p.providerId); }}
                    />
                  )}
                  <PanelBtn label="Disconnect" danger onClick={async () => {
                    setBusy(`${p.providerId}:del`);
                    try {
                      await disconnectCredential(settings.backendUrl, cred.id);
                      setTesting((prev) => { const n = { ...prev }; delete n[p.providerId]; return n; });
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
                providerName={p.name}
                help={help[p.providerId]}
                keyInput={keyInput}
                setKeyInput={(v) => { setKeyInput(v); if (formNote?.tone === 'bad') setFormNote(null); }}
                busy={formBusy}
                rotate={!!cred}
                note={formNote}
                wrongProvider={wrongProvider ? detected : null}
                onSwitchProvider={(pid) => {
                  const target = providers.find((x) => x.providerId === pid);
                  if (target) {
                    setOpenForm(pid);
                    ensureHelp(pid);
                    setFormNote({ tone: 'ok', text: `Pasted under ${target.name} — the key stays in this field.` });
                  }
                }}
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
                    await saveDefaultRoute(settings.backendUrl, { provider: p.providerId, model: mid }).catch(() => {});
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
        'h-8 px-2.5 rounded-lg border text-small font-medium disabled:opacity-50',
        danger
          ? 'border-danger/30 text-danger hover:bg-danger/10'
          : 'border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
      )}
    >
      {busy ? '…' : label}
    </button>
  );
}

function KeyForm({ providerId, providerName, help, keyInput, setKeyInput, busy, rotate, note, wrongProvider, onSwitchProvider, onSave }: {
  providerId: string;
  providerName: string;
  help?: { keyUrl: string | null; docsUrl: string | null; steps: string[] };
  keyInput: string;
  setKeyInput: (v: string) => void;
  busy: boolean;
  rotate: boolean;
  note: { tone: 'ok' | 'bad' | 'warn' | 'busy'; text: string } | null;
  wrongProvider: string | null;
  onSwitchProvider: (pid: string) => void;
  onSave: () => void;
}) {
  const clean = normalizeApiKey(keyInput);
  const looksTooShort = clean.length > 0 && clean.length < 20;
  return (
    <div className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-small font-medium text-[var(--fg-muted)]">{rotate ? `Replace ${providerName} key` : `${providerName} API key`}</p>
        {help?.keyUrl && (
          <a href={help.keyUrl} target="_blank" rel="noreferrer" className="text-small text-[var(--accent)] hover:underline inline-flex items-center gap-1">
            Get a key <ExternalLink size={11} />
          </a>
        )}
      </div>

      {help?.steps?.length ? (
        <ol className="mt-1.5 space-y-0.5 text-micro text-[var(--fg-muted)] list-decimal list-inside">
          {help.steps.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      ) : null}

      <input
        type="password"
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && clean && !busy) onSave(); }}
        placeholder="Paste key — stored encrypted, never shown again"
        className="mt-2 h-10 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3 font-mono text-ui outline-none focus:border-[var(--accent)]"
        aria-label={`${providerId} API key`}
        autoFocus
      />

      {wrongProvider && (
        <p className="mt-1.5 text-micro text-warning">
          That looks like a {wrongProvider} key.{' '}
          <button onClick={() => onSwitchProvider(wrongProvider)} className="underline hover:brightness-110">Use {wrongProvider} instead</button>
        </p>
      )}
      {looksTooShort && !wrongProvider && (
        <p className="mt-1.5 text-micro text-[var(--fg-muted)]">That is shorter than most provider keys — check nothing was cut off.</p>
      )}

      <p className="mt-1.5 text-micro text-[var(--fg-faint)] flex items-center gap-1.5">
        <ShieldCheck size={12} className="text-success shrink-0" />
        Encrypted at rest. The gateway never returns it to the browser.
      </p>

      {note && (
        <p className={cn('mt-2 flex items-start gap-2 text-small',
          note.tone === 'ok' ? 'text-success' : note.tone === 'bad' ? 'text-danger' : note.tone === 'warn' ? 'text-warning' : 'text-[var(--fg-muted)]')}>
          <span className="mt-0.5 shrink-0">
            {note.tone === 'ok' ? <Check size={14} /> : note.tone === 'busy' ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
          </span>
          {note.text}
        </p>
      )}

      <button
        onClick={onSave}
        disabled={busy || !clean}
        className="mt-2 h-9 w-full rounded-xl bg-[var(--accent-solid)] text-[var(--accent-on-solid)] text-ui font-semibold disabled:opacity-50"
      >
        {busy ? 'Connecting…' : rotate ? 'Replace & verify' : 'Connect & verify'}
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
        <p className="text-small font-medium text-[var(--fg-muted)] flex-1">Default model for {providerId}</p>
        <button onClick={onRefresh} className="text-small text-[var(--accent)] hover:underline">Update models</button>
      </div>
      {!models.length && <p className="text-small text-[var(--fg-faint)]">No models cached — press Update models.</p>}
      <div className="space-y-1 max-h-[220px] overflow-y-auto">
        {models.map((m) => (
          <button
            key={m.modelId}
            onClick={() => onPick(m.modelId)}
            className={cn(
              'w-full text-left px-2.5 py-1.5 rounded-lg text-small font-mono hover:bg-[var(--surface-elevated)]',
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

// No keys yet: one screen, one field, one action. Choose a provider (OpenRouter
// first because its free models need no card), paste, connect, verify — the
// verdict is shown here rather than as a toast the user may miss.
function OnboardingCard({ providers, help, ensureHelp, onDone }: {
  providers: { providerId: string; name: string }[];
  help: Record<string, { keyUrl: string | null; docsUrl: string | null; steps: string[] }>;
  ensureHelp: (pid: string) => void;
  onDone: () => Promise<void>;
}) {
  const { settings, toast } = useApp();
  const [pid, setPid] = useState(providers[0]?.providerId || 'openrouter');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const h = help[pid];
  useEffect(() => {
    ensureHelp(pid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  const detected = detectProviderFromKey(key);

  const connect = async () => {
    const clean = normalizeApiKey(key);
    if (!clean || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const c = await connectCredential(settings.backendUrl, pid, clean);
      const t = await testCredential(settings.backendUrl, c.id);
      setKey('');
      if (!t.ok) throw new Error(t.detail || `The provider rejected this key (${t.status}).`);
      await saveDefaultRoute(settings.backendUrl, { provider: pid }).catch(() => {});
      setNote({
        tone: 'ok',
        text: c.credential_key === 'ephemeral'
          ? `Verified${t.latencyMs ? ` in ${t.latencyMs}ms` : ''} — you are live. Note: this server has no stable encryption key, so stored keys stop working after a restart.`
          : `Verified${t.latencyMs ? ` in ${t.latencyMs}ms` : ''} — you are live.`,
      });
      toast({ title: 'You are live', desc: `${providers.find((p) => p.providerId === pid)?.name ?? pid} will answer your chat.` });
      await onDone();
    } catch (err) {
      setNote({ tone: 'bad', text: err instanceof Error ? err.message : 'Connect failed.' });
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[var(--accent)]/[0.06] p-4">
      <p className="text-body font-semibold text-[var(--fg)]">Connect your AI — one key, three steps.</p>
      <p className="text-small text-[var(--fg-muted)] mt-0.5">Pick a provider → paste the key → verify. Nothing else is needed.</p>

      <div className="flex gap-1.5 mt-3 flex-wrap">
        {providers.slice(0, 6).map((p) => (
          <button
            key={p.providerId}
            onClick={() => { setPid(p.providerId); setNote(null); }}
            className={cn('h-9 px-3.5 rounded-xl border text-ui font-medium',
              pid === p.providerId ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-muted)]')}
            aria-pressed={pid === p.providerId}
          >
            {p.name}
          </button>
        ))}
      </div>
      {FREE_NOTE[pid] && <p className="mt-2 text-micro text-[var(--fg-muted)]">{FREE_NOTE[pid]}</p>}

      <div className="flex items-center justify-between gap-2 mt-2.5">
        {h?.keyUrl ? (
          <a href={h.keyUrl} target="_blank" rel="noreferrer" className="text-ui text-[var(--accent)] hover:underline inline-flex items-center gap-1">
            Get a key <ExternalLink size={11} />
          </a>
        ) : <span />}
        {detected && detected !== pid && (
          <button onClick={() => { setPid(detected); setNote(null); }} className="text-micro text-warning underline">
            Looks like a {detected} key — switch
          </button>
        )}
      </div>

      <input
        type="password"
        value={key}
        onChange={(e) => { setKey(e.target.value); if (note?.tone === 'bad') setNote(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
        placeholder="Paste API key"
        className="mt-2 h-11 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3.5 font-mono text-ui outline-none focus:border-[var(--accent)]"
        aria-label="API key"
      />

      {note && (
        <p className={cn('mt-2 flex items-center gap-2 text-small', note.tone === 'ok' ? 'text-success' : 'text-danger')}>
          {note.tone === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />} {note.text}
        </p>
      )}

      <button
        disabled={busy || !normalizeApiKey(key)}
        onClick={connect}
        className="mt-2.5 h-11 w-full rounded-xl bg-[var(--accent-solid)] text-[var(--accent-on-solid)] text-body font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {busy ? <><Loader2 size={15} className="animate-spin" /> Connecting & verifying…</> : 'Connect & verify'}
      </button>
    </div>
  );
}
