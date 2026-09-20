import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';

// Waveform with two sources of truth:
// - level (0..1 real mic energy): bars mirror the actual input —
//   if these never move while you talk, the mic isn't reaching us.
// - otherwise a gentle simulated shimmer (model speaking).
export function VoiceVisualizer({
  active, bars = 28, color = 'indigo', level,
}: {
  active: boolean;
  bars?: number;
  color?: 'indigo' | 'emerald';
  level?: number;
}) {
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: bars }, () => 0.3));

  useEffect(() => {
    if (level !== undefined) {
      setLevels(
        Array.from({ length: bars }, (_, i) => {
          const center = 1 - Math.abs(i - bars / 2) / (bars / 2);
          const wobble = 0.75 + 0.25 * Math.sin(Date.now() / 240 + i * 0.9);
          return 0.08 + center * level * 1.1 * wobble;
        })
      );
      return;
    }
    if (!active) {
      setLevels(Array.from({ length: bars }, () => 0.18));
      return;
    }
    const id = window.setInterval(() => {
      setLevels(
        Array.from({ length: bars }, (_, i) => {
          const center = 1 - Math.abs(i - bars / 2) / (bars / 2);
          return 0.2 + center * (0.25 + Math.random() * 0.75);
        })
      );
    }, 110);
    return () => window.clearInterval(id);
  }, [active, bars, level]);

  return (
    <div className="flex items-center justify-center gap-[3px] h-12" aria-hidden>
      {levels.map((l, i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] rounded-full transition-all duration-150',
            color === 'emerald' ? 'bg-emerald-300/80' : 'bg-indigo-300/80'
          )}
          style={{ height: `${Math.max(4, Math.min(1.2, l) * 44)}px`, opacity: 0.35 + Math.min(1, l) * 0.65 }}
        />
      ))}
    </div>
  );
}
