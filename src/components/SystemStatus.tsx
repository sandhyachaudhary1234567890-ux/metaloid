import { useApp } from '../lib/store';
import type { ServiceHealth } from '../lib/transport';
import { cn } from '../lib/cn';

// Quiet system status — real backend state, never decorative.
// Offline rows read "Not connected", never fake-green.

const ROWS: { key: keyof ServiceHealth; label: string; hint: string }[] = [
  { key: 'server', label: 'Server', hint: 'Gateway reachability' },
  { key: 'ai', label: 'AI', hint: 'Chat + reasoning' },
  { key: 'voice', label: 'Voice', hint: 'Server STT/TTS (local realtime loop runs in-app)' },
  { key: 'vision', label: 'Vision', hint: 'Image understanding' },
  { key: 'realtime', label: 'Realtime', hint: 'Live channel' },
  { key: 'database', label: 'Database', hint: 'Memory + history' },
];

export function SystemStatus() {
  const { health, connection, recheckConnection } = useApp();
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border-subtle)]">
      {ROWS.map((r) => {
        const ok = health[r.key];
        return (
          <div key={r.key} className="flex items-center gap-3 px-3.5 py-2.5">
            <span className={cn('h-2 w-2 rounded-full shrink-0',
              connection === 'checking' ? 'bg-amber-400 animate-pulse' : ok ? 'bg-emerald-400' : 'bg-[var(--fg-subtle)]')} />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium text-[var(--fg)]">{r.label}</span>
              <span className="block text-[11.5px] text-[var(--fg-muted)]">{r.hint}</span>
            </span>
            <span className={cn('text-[12px] font-medium shrink-0', ok ? 'text-emerald-400' : 'text-[var(--fg-muted)]')}>
              {connection === 'checking' ? 'Checking…' : ok ? 'Operational' : 'Not connected'}
            </span>
          </div>
        );
      })}
      <div className="px-3.5 py-2.5">
        <button onClick={() => recheckConnection()} className="btn-ghost h-8 px-3 text-[12.5px] w-full">
          Recheck connection
        </button>
      </div>
    </div>
  );
}
