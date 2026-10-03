import { cn } from '../lib/cn';

export type HomeTab = 'chat' | 'vision' | 'agents';

// Clean top mode tabs for HomeScreen
export function TopBar({ tab, onTab }: { tab: HomeTab; onTab: (t: HomeTab) => void }) {
  const tabs: { id: HomeTab; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'vision', label: 'Vision' },
    { id: 'agents', label: 'Agents' },
  ];
  return (
    <nav className="flex items-center justify-center gap-7" aria-label="Assistant modes">
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative pb-2 text-[14px] font-medium transition-colors duration-150',
              active ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'
            )}
          >
            {t.label}
            <span
              className={cn(
                'absolute inset-x-2 -bottom-0.5 h-[2px] rounded-full bg-[var(--accent)] transition-all duration-200',
                active ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'
              )}
            />
          </button>
        );
      })}
    </nav>
  );
}
