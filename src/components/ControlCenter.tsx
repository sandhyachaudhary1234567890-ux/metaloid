import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { SettingsRow, Seg } from './SettingsGroup';
import {
  fetchProfile, saveProfile, fetchUsage, exportAccount, deleteAccount,
  forgetAllServerMemories, fetchDevices, requestDevicePairing,
  revokeDevice, logoutEverywhere, type PairedDevice,
} from '../lib/transport';
import { clearSession } from '../lib/auth';
import { cn } from '../lib/cn';

// Metaloid Control Center — Profile · Autonomy · Usage · Devices · Data.
// Everything here is per-user and server-enforced. Offline demo shows a hint.
export function ControlCenter() {
  const { settings, connection, authUser, logout, toast, refreshAuth, setView } = useApp();
  const online = connection === 'online' && !!authUser;
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [plan, setPlan] = useState('free');
  const [usage, setUsage] = useState<Record<string, { usedToday: number; limit: number | string }> | null>(null);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!online) return;
    try {
      const p = await fetchProfile(settings.backendUrl);
      setProfile(p.profile);
      setPlan(p.plan);
      const u = (await fetchUsage(settings.backendUrl)) as Record<string, unknown>;
      const { plan: _p, label: _l, ...rest } = u;
      void _p; void _l;
      setUsage(rest as typeof usage);
      setDevices(await fetchDevices(settings.backendUrl));
    } catch {
      /* offline mid-load — stay quiet */
    }
  }, [online, settings.backendUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (delta: Record<string, unknown>) => {
    setSaving(true);
    try {
      const next = await saveProfile(settings.backendUrl, delta);
      setProfile(next);
      toast({ title: 'Saved.' });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Save failed.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!online) {
    return (
      <div>
        <p className="text-small text-[var(--fg-muted)]">Sign in with the gateway online to manage your profile, autonomy, devices, and data.</p>
        <button onClick={() => setView('settings')} className="btn-ghost h-9 px-3.5 mt-2 text-small">Open connection settings</button>
      </div>
    );
  }

  const usageRow = (label: string, k: string) => {
    const u = usage?.[k];
    if (!u) return null;
    const pct = typeof u.limit === 'number' && u.limit > 0 ? Math.min(100, Math.round((u.usedToday / u.limit) * 100)) : 0;
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="w-24 text-small text-[var(--fg-muted)]">{label}</span>
        <span className="flex-1 h-1.5 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
          <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-small font-mono text-[var(--fg-muted)]">
          {u.usedToday}/{u.limit}
        </span>
      </div>
    );
  };

  return (
    <div>
      {/* ---- account ---- */}
      <SettingsRow
        label={authUser ? `@${authUser.handle}` : 'Account'}
        hint={authUser?.role === 'admin' ? 'Admin · first account on this gateway' : 'Private instance — isolated context'}
        control={
          <span className="flex gap-2">
            <button
              onClick={() => logout()}
              className="h-9 px-3.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-small font-medium hover:border-[var(--accent)]"
            >
              Switch account
            </button>
          </span>
        }
      />

      {/* ---- profile ---- */}
      <SettingsRow
        label="Display name"
        hint="What Metaloid calls you — spoken and written"
        control={
          <input
            value={(profile?.displayName as string) || ''}
            onChange={(e) => setProfile({ ...(profile || {}), displayName: e.target.value })}
            onBlur={(e) => patch({ displayName: e.target.value })}
            placeholder="Your name"
            className="h-9 w-44 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] px-3 text-small text-[var(--fg)] outline-none"
            aria-label="Display name"
          />
        }
      />
      <SettingsRow
        label="Language"
        hint="Reply language across chat and voice"
        control={
          <Seg
            options={['auto', 'en', 'hinglish', 'hi'] as const}
            value={((profile?.language as string) || 'auto') as 'auto'}
            onPick={(v) => {
              setProfile({ ...(profile || {}), language: v });
              patch({ language: v });
            }}
            label="Language"
          />
        }
      />
      <SettingsRow
        label="Tone"
        hint="How Metaloid sounds to you"
        control={
          <Seg
            options={['neutral', 'warm', 'concise', 'playful', 'formal'] as const}
            value={((profile?.tone as string) || 'neutral') as 'neutral'}
            onPick={(v) => {
              setProfile({ ...(profile || {}), tone: v });
              patch({ tone: v });
            }}
            label="Tone"
          />
        }
      />
      <SettingsRow
        label="Answer depth"
        hint="Brief, balanced, or detailed by default"
        control={
          <Seg
            options={['brief', 'balanced', 'detailed'] as const}
            value={((profile?.verbosity as string) || 'balanced') as 'balanced'}
            onPick={(v) => {
              setProfile({ ...(profile || {}), verbosity: v });
              patch({ verbosity: v });
            }}
            label="Verbosity"
          />
        }
      />

      {/* ---- autonomy: a real policy setting ---- */}
      <SettingsRow
        label="Independence"
        hint="Calm waits for you · Helpful suggests next steps · higher levels act ahead (never raised automatically)"
        control={
          <Seg
            options={['passive', 'assisted', 'proactive', 'autonomous'] as const}
            value={((profile?.autonomy as string) || 'assisted') as 'assisted'}
            onPick={(v) => {
              setProfile({ ...(profile || {}), autonomy: v, proactivity: v });
              patch({ autonomy: v, proactivity: v });
            }}
            label="Autonomy"
          />
        }
      />
      {saving && <p className="text-micro text-[var(--fg-faint)]">Saving…</p>}

      {/* ---- usage ---- */}
      <div className="pt-1">
        <p className="text-small font-medium text-[var(--fg-muted)] mb-1">
          Plan: <span className="text-[var(--fg)] font-semibold capitalize">{plan}</span>
        </p>
        {usageRow('Chat', 'chat')}
        {usageRow('Missions', 'missions')}
        {usageRow('OSINT', 'osint')}
        {usageRow('Voice', 'voice-min')}
      </div>

      {/* ---- devices ---- */}
      <div className="pt-2">
        <p className="text-small font-medium text-[var(--fg-muted)] mb-1">Paired devices ({devices.length})</p>
        {devices.map((d) => (
          <div key={d.id} className="flex items-center gap-2 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success/10" />
            <span className="text-ui text-[var(--fg)] flex-1">{d.name}</span>
            <button
              onClick={async () => {
                await revokeDevice(settings.backendUrl, d.id);
                setDevices(devices.filter((x) => x.id !== d.id));
                toast({ title: 'Device unpaired.' });
              }}
              className="text-small text-danger hover:text-danger"
            >
              Unpair
            </button>
          </div>
        ))}
        {devices.length === 0 && !pairCode && (
          <p className="text-small text-[var(--fg-faint)]">No devices paired yet.</p>
        )}
        {pairCode ? (
          <p className="text-small text-[var(--fg-muted)] mt-1">
            Pairing code: <span className="font-mono text-read font-bold text-[var(--fg)] tracking-[0.2em]">{pairCode}</span>
            <span className="block text-micro text-[var(--fg-faint)]">Enter it on the new device within 10 minutes.</span>
          </p>
        ) : (
          <button
            onClick={async () => {
              try {
                const r = await requestDevicePairing(settings.backendUrl, `${navigator.platform || 'Browser'} · this browser`);
                setPairCode(r.code);
              } catch (e) {
                toast({ title: e instanceof Error ? e.message : 'Pairing failed.', tone: 'error' });
              }
            }}
            className="mt-1.5 h-9 px-3.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-small font-medium hover:border-[var(--accent)]"
          >
            Pair a new device…
          </button>
        )}
        <button
          onClick={async () => {
            try {
              const r = await logoutEverywhere(settings.backendUrl);
              toast({ title: `Signed out everywhere (${(r as { revoked: number }).revoked} sessions).` });
              await refreshAuth();
            } catch (e) {
              toast({ title: e instanceof Error ? e.message : 'Failed.' });
            }
          }}
          className="mt-1.5 ml-2 h-9 px-3.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-small font-medium hover:border-danger/30"
        >
          Sign out everywhere
        </button>
      </div>

      {/* ---- data ---- */}
      <div className="flex flex-col sm:flex-row gap-2.5 pt-3">
        <button
          onClick={async () => {
            try {
              const data = await exportAccount(settings.backendUrl);
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `metaloid-export-${authUser?.handle || 'user'}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              toast({ title: 'Export downloaded.' });
            } catch (e) {
              toast({ title: e instanceof Error ? e.message : 'Export failed.', tone: 'error' });
            }
          }}
          className="btn-ghost h-10 px-4 text-ui flex-1"
        >
          Export my data
        </button>
        <button
          onClick={async () => {
            try {
              await forgetAllServerMemories(settings.backendUrl);
              toast({ title: 'Server memories forgotten.' });
            } catch (e) {
              toast({ title: e instanceof Error ? e.message : 'Could not forget memories.', tone: 'error' });
            }
          }}
          className="btn-ghost h-10 px-4 text-ui flex-1"
        >
          Forget server memories
        </button>
      </div>
      <div className="pt-2.5">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="btn-danger h-10 px-4 text-ui w-full">
            Delete my account…
          </button>
        ) : (
          <div className={cn('rounded-xl border border-danger/30 bg-danger/5 p-3.5')}>
            <p className="text-ui text-[var(--fg)] font-semibold">Delete everything? Memories, missions, workspaces, devices — gone.</p>
            <div className="flex gap-2 mt-2.5">
              <button onClick={() => setConfirmDelete(false)} className="btn-ghost h-9 px-4 text-ui flex-1">
                Keep it
              </button>
              <button
                onClick={async () => {
                  try {
                    await deleteAccount(settings.backendUrl);
                    clearSession();
                    await logout();
                  } catch (e) {
                    toast({ title: e instanceof Error ? e.message : 'Deletion failed.', tone: 'error' });
                  }
                }}
                className="h-9 px-4 rounded-lg bg-danger/10 text-white text-ui font-semibold flex-1"
              >
                Yes, delete everything
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
