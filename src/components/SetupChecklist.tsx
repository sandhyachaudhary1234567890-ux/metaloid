import { Check } from 'lucide-react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';

// SetupChecklist — the process indicator new users asked for.
//
// Sign in → connect a key → chat live. Each step reads real state (gateway
// health, session, connection) and points at the exact screen that unblocks
// the next one. It renders only while the app is NOT live, so it can never
// nag a working setup — the moment step 3 completes, this returns null.

export function SetupChecklist() {
  const { connection, health, setView, recheckConnection } = useApp();
  const auth = useAuth();

  if (connection === 'online') return null;

  const gatewayOk = !!health?.server;
  const signedIn = !auth.configured || auth.status === 'signed-in';
  const byok = !!health?.byok;
  const ownKeys = health?.byokProviders ?? [];
  // A stored key the server cannot open is NOT the same as no key: the user
  // already did the work, so send them to "replace it", not to "connect one".
  const unreadable = health?.byokUnreadable ?? [];
  const rejected = health?.byokRejected ?? [];
  const broken = [...unreadable, ...rejected];

  const liveNote =
    connection === 'checking'
      ? 'Checking the gateway…'
      : unreadable.length
        ? `Your saved ${unreadable.join(', ')} key can no longer be decrypted on the server — replace it to go live again.`
        : rejected.length
          ? `The provider rejected your ${rejected.join(', ')} key — replace it to go live again.`
          : byok
          ? `Your key is connected${ownKeys.length ? ` (${ownKeys.join(', ')})` : ''} — send a message, or recheck if this looks stale.`
          : connection === 'degraded'
          ? 'The gateway answers but the provider does not — usually a rejected or missing key.'
          : connection === 'mock'
            ? 'Sandbox provider active — answers are local demos, clearly labelled.'
            : 'No gateway reached — answers come from the on-device demo engine.';

  const steps = [
    {
      n: 1,
      title: 'Gateway connected',
      detail: gatewayOk ? 'MetaIoid server is reachable.' : 'Point the app at your gateway and retry.',
      done: gatewayOk,
      action: gatewayOk ? null : { label: 'Recheck', onClick: () => recheckConnection() },
    },
    {
      n: 2,
      title: 'Signed in',
      detail: !auth.configured
        ? 'This build needs no account — you are already in.'
        : signedIn
          ? 'Your session is active.'
          : 'Sign in to sync across devices.',
      done: signedIn,
      action: null, // the app gates to the sign-in screen itself when needed
    },
    {
      n: 3,
      title: 'AI provider live',
      detail: liveNote,
      done: byok,
      action: byok
        ? { label: 'Recheck', onClick: () => recheckConnection() }
        : broken.length
          ? { label: 'Replace key', onClick: () => setView('settings') }
          : { label: 'Connect a key', onClick: () => setView('settings') },
    },
  ];

  return (
    <div
      className="mx-auto mt-8 w-full max-w-[var(--welcome-width)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-left"
      role="status"
      aria-label="Setup progress: connect a key to go live"
    >
      <p className="text-small font-semibold tracking-[0.14em] text-[var(--fg-muted)]">
        GET LIVE IN {steps.length} STEPS
      </p>
      <ol className="mt-2.5 flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.n} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-micro font-bold',
                s.done
                  ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--fg-faint)]',
              )}
            >
              {s.done ? <Check size={11} strokeWidth={3} /> : s.n}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-ui font-medium text-[var(--fg)]">{s.title}</span>
              <span className="block text-small text-[var(--fg-muted)]">{s.detail}</span>
            </span>
            {s.action && (
              <button
                onClick={s.action.onClick}
                className="h-8 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-small font-medium text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {s.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
