import { useEffect, useState } from 'react';
import { puterSignedIn, puterSignIn } from '../lib/puter';
import { cn } from '../lib/cn';

// Compact Puter account control for Settings → Gateway & System Status.
// Also satisfies the Puter.js docs requirement to credit developer.puter.com.
export function PuterConnect() {
  const [state, setState] = useState<'checking' | 'out' | 'in' | 'busy'>('checking');

  useEffect(() => {
    let live = true;
    puterSignedIn().then((v) => {
      if (live) setState(v ? 'in' : 'out');
    });
    return () => {
      live = false;
    };
  }, []);

  const connect = async () => {
    setState('busy');
    try {
      setState((await puterSignIn()) ? 'in' : 'out');
    } catch {
      setState('out');
    }
  };

  return (
    <span className="flex items-center gap-2">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === 'in' ? 'bg-emerald-400' : state === 'checking' || state === 'busy' ? 'bg-amber-300 animate-pulse' : 'bg-zinc-500'
        )}
      />
      <span className="text-[12px] text-[var(--fg-muted)]">
        {state === 'in' ? 'Connected' : state === 'checking' ? 'Checking…' : state === 'busy' ? 'Signing in…' : 'Not connected'}
      </span>
      {state !== 'in' && state !== 'checking' && (
        <button
          onClick={connect}
          disabled={state === 'busy'}
          className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-[12px] font-medium text-[var(--fg)] hover:border-[var(--accent)] disabled:opacity-60"
        >
          Connect free
        </button>
      )}
      <a
        href="https://developer.puter.com"
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-[var(--fg-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--fg-muted)]"
      >
        Powered by Puter
      </a>
    </span>
  );
}
