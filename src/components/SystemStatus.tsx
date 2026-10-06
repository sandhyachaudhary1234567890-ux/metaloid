import { useApp } from '../lib/store';
import type { ServiceHealth } from '../lib/transport';
import { cn } from '../lib/cn';

// Quiet system status — real backend state, never decorative.
// Offline rows read "Not connected", never fake-green.
//
// Two things this panel refuses to do:
//   1. claim a service is operational because a key is merely *set*
//   2. hide why a model is being skipped (rejected slugs are shown, flagged)

const ROWS: { key: keyof ServiceHealth; label: string; hint: string }[] = [
  { key: 'server', label: 'Server', hint: 'Gateway reachability' },
  { key: 'ai', label: 'AI', hint: 'Chat + reasoning' },
  { key: 'voice', label: 'Voice', hint: 'Runs in-browser (STT + TTS), not the gateway' },
  { key: 'vision', label: 'Vision', hint: 'Image understanding' },
  { key: 'realtime', label: 'Realtime', hint: 'Live SSE channel' },
  { key: 'database', label: 'Database', hint: 'Server store — memory + history are local' },
];

export function SystemStatus() {
  const { health, connection, recheckConnection } = useApp();
  const provider = health?.provider;
  const mock = provider === 'local-mock';
  const degraded = connection === 'degraded' || (!!health?.degraded && !health?.ai);

  // The user's own connected key is a live path even when the shared provider
  // key is absent or unhealthy — say that, instead of showing "no provider".
  const ownKeys = health?.byokProviders ?? [];
  const unreadable = health?.byokUnreadable ?? [];
  const rejected = health?.byokRejected ?? [];
  const billing = connection === 'checking' ? null
    : mock ? { label: 'Sandbox provider', tone: 'violet' as const }
    : health?.ai ? { label: `Live: ${provider}`, tone: 'emerald' as const }
    : health?.byok ? { label: `Live: your key${ownKeys.length ? ` (${ownKeys.join(', ')})` : ''}`, tone: 'emerald' as const }
    : unreadable.length ? { label: 'Saved key needs replacing', tone: 'amber' as const }
    : rejected.length ? { label: 'Saved key was rejected', tone: 'amber' as const }
    : degraded ? { label: 'Provider unreachable', tone: 'amber' as const }
    : { label: 'No provider connected', tone: 'muted' as const };

  const toneClass = {
    emerald: 'text-success border-success/30 bg-success/10',
    amber: 'text-warning border-warning/30 bg-warning/10',
    violet: 'text-info border-info/30 bg-info/10',
    muted: 'text-[var(--fg-muted)] border-[var(--border)] bg-[var(--surface-elevated)]',
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border-subtle)]">
      {billing && (
        <div className="px-3.5 py-2.5 flex items-center gap-3">
          <span className={cn('text-micro font-semibold tracking-wide border rounded-full px-2.5 py-1', toneClass[billing.tone])}>
            {billing.label}
          </span>
          {typeof health?.models?.free === 'number' && (
            <span className="text-micro text-[var(--fg-muted)]">
              {health.models.free} model{health.models.free === 1 ? '' : 's'} usable
              {health.models.catalogue === false ? ' · catalogue unreachable' : ''}
            </span>
          )}
        </div>
      )}
      {ROWS.map((r) => {
        const ok = health[r.key];
        return (
          <div key={r.key} className="flex items-center gap-3 px-3.5 py-2.5">
            <span className={cn('h-2 w-2 rounded-full shrink-0',
              connection === 'checking' ? 'bg-[var(--warning)] animate-pulse-soft' : ok ? 'bg-[var(--success)]' : 'bg-[var(--fg-subtle)]')} />
            <span className="flex-1 min-w-0">
              <span className="block text-ui font-medium text-[var(--fg)]">{r.label}</span>
              <span className="block text-micro text-[var(--fg-muted)]">{r.hint}</span>
            </span>
            <span className={cn('text-small font-medium shrink-0', ok ? 'text-success' : 'text-[var(--fg-muted)]')}>
              {connection === 'checking' ? 'Checking…'
                : ok ? (r.key === 'ai' && mock ? 'Sandbox' : 'Operational')
                : r.key === 'ai' && (unreadable.length || rejected.length) ? 'Key needs replacing'
                : 'Not connected'}
            </span>
          </div>
        );
      })}
      <div className="px-3.5 py-2.5">
        <button onClick={() => recheckConnection()} className="btn-ghost h-8 px-3 text-small w-full">
          Recheck connection
        </button>
      </div>
    </div>
  );
}
