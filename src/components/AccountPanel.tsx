// Account & provider keys — the one place the app talks to the account layer.
//
// Every action here goes through `repo` (which talks to the MetaIoid gateway)
// or through `useAuth` (Supabase Auth). No Supabase table is ever touched from
// the UI, and no raw key is ever kept: it is typed, sent, and cleared.

import { useEffect, useState } from 'react';
import { UserRound, KeyRound, LogOut, RefreshCw, ShieldCheck, Trash2, Check, Loader2, Plug, AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { useSyncState, syncLabel } from '../lib/sync';
import { repo, RepoError, type CredentialRow, type ProviderSettingsRow } from '../lib/repo';
import { SettingsSection, SettingsRow } from './SettingsGroup';
import { cn } from '../lib/cn';

/** Demo builds have no backend: say so plainly rather than showing dead buttons. */
function NotConfigured() {
  return (
    <SettingsSection
      icon={UserRound}
      title="Account"
      desc="Local sandbox mode — everything stays on this device"
    >
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3.5 text-[12.5px] text-[var(--fg-muted)] leading-relaxed">
        This build has no Supabase project configured, so there is no account to sign in
        to and nothing is uploaded anywhere. Conversations, memories and settings live in
        this browser only.
        <div className="mt-2 text-[12px]">
          To connect a real backend: set <code className="px-1 py-0.5 rounded bg-[var(--surface-elevated)]">VITE_SUPABASE_URL</code> and{' '}
          <code className="px-1 py-0.5 rounded bg-[var(--surface-elevated)]">VITE_SUPABASE_ANON_KEY</code>,
          then configure the gateway (see <code className="px-1 py-0.5 rounded bg-[var(--surface-elevated)]">.env.example</code>).
        </div>
      </div>
    </SettingsSection>
  );
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  connected: { label: 'connected', className: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
  invalid: { label: 'invalid', className: 'text-red-400 border-red-400/30 bg-red-400/10' },
  unverified: { label: 'needs setup', className: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  unconfigured: { label: 'needs setup', className: 'text-[var(--fg-muted)] border-[var(--border)] bg-[var(--surface-sunken)]' },
};

function Pill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.unconfigured;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium', s.className)}>
      {s.label}
    </span>
  );
}

export function AccountSection() {
  const auth = useAuth();
  const { toast } = useApp();
  const sync = useSyncState();

  const [creds, setCreds] = useState<CredentialRow[] | null>(null);
  const [provSettings, setProvSettings] = useState<ProviderSettingsRow | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const token = auth.accessToken;
  const signedIn = auth.status === 'signed-in';

  // Load the mask + settings. If this fails the panel stays honest about it
  // instead of showing an empty list that looks like "no keys".
  useEffect(() => {
    if (!token) { setCreds(null); setProvSettings(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const [c, s] = await Promise.all([repo.listCredentials(token), repo.getProviderSettings(token)]);
        if (cancelled) return;
        setCreds(c.credentials);
        setProvSettings(s.settings);
      } catch {
        if (!cancelled) setCreds([]);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (!auth.configured) return <NotConfigured />;

  const openrouter = creds?.find((c) => c.provider === 'openrouter') || null;
  const label = signedIn ? syncLabel(sync, true) : syncLabel(sync, false);

  const describe = (e: unknown, fallback: string) =>
    e instanceof RepoError ? e.message : fallback;

  async function saveKey() {
    if (!token) return;
    const value = apiKey.trim();
    if (value.length < 8) { setKeyError('That looks too short for a provider key.'); return; }
    setBusy('save'); setKeyError(null);
    try {
      const res = await repo.saveCredential(token, 'openrouter', value);
      setApiKey(''); // never keep it in component state after it is stored
      setCreds((prev) => [...(prev || []).filter((c) => c.provider !== 'openrouter'), res.credential]);
      toast({ title: 'Key stored — encrypted on the server' });
    } catch (e) {
      setKeyError(describe(e, 'The gateway could not store that key.'));
    } finally { setBusy(null); }
  }

  async function testKey() {
    if (!token) return;
    setBusy('test'); setKeyError(null);
    try {
      const res = await repo.testCredential(token, 'openrouter', {});
      const next = res.status === 'connected' ? 'connected' : 'invalid';
      setCreds((prev) => (prev || []).map((c) => (c.provider === 'openrouter' ? { ...c, status: next } : c)));
      toast({ title: res.ok ? `Connected in ${res.latency_ms} ms` : res.detail });
    } catch (e) {
      setKeyError(describe(e, 'The provider test could not run.'));
    } finally { setBusy(null); }
  }

  async function removeKey() {
    if (!token) return;
    setBusy('delete');
    try {
      await repo.deleteCredential(token, 'openrouter');
      setCreds((prev) => (prev || []).filter((c) => c.provider !== 'openrouter'));
      toast({ title: 'Key removed' });
    } catch (e) {
      setKeyError(describe(e, 'The key could not be removed.'));
    } finally { setBusy(null); }
  }

  async function savePreference(patch: { default_model?: string | null; fallback_enabled?: boolean; free_only?: boolean }) {
    if (!token) return;
    try {
      const res = await repo.saveProviderSettings(token, patch);
      setProvSettings(res.settings);
    } catch { /* the toggle simply does not move */ }
  }

  async function deleteAccount() {
    if (!token) return;
    setBusy('delete');
    try {
      await repo.deleteAccount(token);
      await auth.signOut();
      toast({ title: 'Account deleted', desc: 'Profile, data and stored keys were removed.' });
    } catch (e) {
      setKeyError(describe(e, 'The account could not be deleted. Nothing was removed.'));
      setBusy(null);
    }
  }

  return (
    <>
      <SettingsSection
        icon={UserRound}
        title="Account & sync"
        desc={signedIn ? auth.user?.email || 'Signed in' : 'Not signed in — local sandbox mode'}
      >
        <SettingsRow
          label="Session"
          hint={signedIn
            ? 'Your device holds a refresh token; the access token is short-lived and renewed automatically.'
            : 'Sign in to sync conversations, memories and provider keys across devices.'}
          control={
            signedIn ? (
              <button
                onClick={() => { void auth.signOut(); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] font-medium hover:border-[var(--border-strong)] transition-colors min-h-[40px]"
              >
                <LogOut size={14} /> Sign out
              </button>
            ) : (
              <span className="text-[12px] text-[var(--fg-muted)]">Signed out</span>
            )
          }
        />
        <SettingsRow
          label="Sync"
          hint={label.text}
          control={
            <span className={cn(
              'inline-flex items-center gap-1.5 text-[12px] font-medium',
              label.tone === 'ok' ? 'text-emerald-400' : label.tone === 'warn' ? 'text-amber-400' : 'text-[var(--fg-muted)]',
            )}>
              {label.tone === 'ok' ? <Check size={13} /> : label.tone === 'warn' ? <AlertTriangle size={13} /> : <RefreshCw size={13} />}
              {sync.pending > 0 ? `${sync.pending} pending` : label.tone === 'ok' ? 'up to date' : 'local'}
            </span>
          }
        />
      </SettingsSection>

      <SettingsSection
        icon={KeyRound}
        title="Provider keys"
        desc="Stored encrypted on the gateway — never in this browser, never in an API response"
      >
        {openrouter ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3.5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[var(--fg)]">OpenRouter</span>
                <Pill status={openrouter.status} />
              </div>
              <div className="text-[12px] text-[var(--fg-muted)] mt-0.5 font-mono">{openrouter.masked}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={testKey}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[12px] font-medium hover:border-[var(--border-strong)] disabled:opacity-50 min-h-[36px]"
              >
                {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Test
              </button>
              <button
                onClick={removeKey}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[12px] font-medium text-red-400 hover:border-red-400/40 disabled:opacity-50 min-h-[36px]"
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[12.5px] text-[var(--fg-muted)]">
            {signedIn ? 'No key stored yet — the gateway falls back to its own free models.' : 'Sign in to store a key; without one the gateway uses its own free models.'}
          </div>
        )}

        {signedIn && (
          <div className="space-y-2">
            <label htmlFor="provider-key" className="text-[12.5px] font-medium text-[var(--fg)]">
              {openrouter ? 'Replace key' : 'Add an OpenRouter key'}
            </label>
            <div className="flex gap-2">
              <input
                id="provider-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-…"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] text-[13px] font-mono outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={saveKey}
                disabled={busy !== null || apiKey.trim().length === 0}
                className="px-3.5 py-2.5 rounded-xl bg-[var(--accent)] text-white text-[12.5px] font-medium disabled:opacity-50 min-h-[42px]"
              >
                {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
              </button>
            </div>
            <div className="flex items-start gap-1.5 text-[11.5px] text-[var(--fg-muted)]">
              <ShieldCheck size={13} className="mt-0.5 shrink-0" />
              <span>
                Sent once over HTTPS to your gateway, encrypted with AES-256-GCM under a
                server-side key, and shown afterwards only as a mask. It is never written to
                a log, a browser store, or any response.
              </span>
            </div>
          </div>
        )}

        {provSettings && (
          <SettingsRow
            label="Automatic failover"
            hint="Skip a model the provider rejects and try the next free one (recommended)"
            control={
              <button
                role="switch"
                aria-checked={provSettings.fallback_enabled}
                onClick={() => savePreference({ fallback_enabled: !provSettings.fallback_enabled })}
                className={cn(
                  'w-11 h-6 rounded-full border transition-colors relative min-h-[24px]',
                  provSettings.fallback_enabled ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-[var(--surface-sunken)] border-[var(--border)]',
                )}
              >
                <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all', provSettings.fallback_enabled ? 'left-[22px]' : 'left-0.5')} />
              </button>
            }
          />
        )}

        {keyError && (
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-3.5 py-2.5 text-[12.5px] text-red-300">
            {keyError}
          </div>
        )}
      </SettingsSection>

      {signedIn && (
        <SettingsSection
          icon={Trash2}
          title="Delete account"
          desc="Removes the account and everything tied to it — permanently"
        >
          <div className="text-[12.5px] text-[var(--fg-muted)] leading-relaxed">
            Deletes your profile, conversations, messages, memories, attachment records and
            stored files, provider settings and credentials, agent tasks and usage events —
            then the identity itself. Local copies on this device are cleared too. There is no
            undo and no grace period.
          </div>
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={deleteAccount}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-red-500 text-white text-[12.5px] font-semibold disabled:opacity-50 min-h-[42px]"
              >
                {busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Yes, delete everything
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3.5 py-2.5 rounded-xl border border-[var(--border)] text-[12.5px] font-medium min-h-[42px]"
              >
                Keep my account
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-red-400/30 text-red-400 text-[12.5px] font-medium hover:bg-red-400/10 transition-colors min-h-[42px]"
            >
              <Trash2 size={14} /> Delete my account and data
            </button>
          )}
        </SettingsSection>
      )}
    </>
  );
}
