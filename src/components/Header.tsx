import { useApp } from '../lib/store';
import { ModelSelector } from './ModelSelector';

/**
 * The desktop header for every screen except Chat.
 *
 * Chat owns its own identity line (it is the product), so this exists purely
 * to name the screen you are on. It used to repeat the MetaIoid mark that the
 * sidebar already shows, print a second busy indicator, and render a raw
 * `<kbd>` element in system chrome — three competing signals in one 64px row.
 * It is now a title, and the two controls genuinely worth reaching from here.
 */
export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const { status, statusText, setPaletteOpen } = useApp();
  const busy = status !== 'idle' && status !== 'error';

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[var(--page-width)] items-center gap-3 px-4 sm:px-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate t-title text-[var(--fg)]">{title}</h1>

            {/* Real work only, in the product's own words. */}
            {busy && (
              <span className="hidden items-center gap-1.5 text-small text-[var(--fg-muted)] sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse-soft" />
                {statusText}
              </span>
            )}
          </div>
          {subtitle && <p className="mt-0.5 truncate text-small text-[var(--fg-muted)]">{subtitle}</p>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-2 rounded-[var(--radius-md)] px-2 text-small text-[var(--fg-muted)] transition-colors duration-micro ease-out hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] sm:flex"
            aria-label="Open command palette"
            title="Commands"
          >
            Commands
            <span className="kbd">⌘K</span>
          </button>
          <div className="hidden md:block">
            <ModelSelector compact />
          </div>
        </div>
      </div>
    </header>
  );
}
