import React from 'react';

/**
 * ThinkingLinesSpinner — Type 2: 360° Spinning Lines with Orbiting Points (code-20260920-164834)
 * Used in chat while AI is thinking. Renders a delicate, compact 360° spinning constellation
 * of harmonic radial lines and joining points.
 */
export function ThinkingLinesSpinner({
  size = 28,
  lineColor = 'var(--accent)',
  ballColor = 'var(--fg)',
  className = '',
}: {
  size?: number;
  lineColor?: string;
  ballColor?: string;
  className?: string;
}) {
  const radius = size / 2;
  const ballSize = Math.max(3, Math.round(size * 0.16));

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
      }}
      role="status"
      aria-label="AI thinking animation"
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          animation: 'thinkingLinesSpin 4s linear infinite',
        }}
      >
        <div className="relative w-0 h-0">
          {[0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5].map((angle, idx) => (
            <div
              key={angle}
              className="absolute left-0"
              style={{
                top: -radius,
                width: '1px',
                height: radius * 2,
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                transform: `rotate(${angle}deg)`,
                transformOrigin: 'center',
              }}
            >
              {/* Harmonic oscillating point */}
              <div
                className="absolute left-1/2 rounded-full"
                style={{
                  width: ballSize,
                  height: ballSize,
                  backgroundColor: ballColor,
                  boxShadow: `0 0 6px ${lineColor}`,
                  transform: 'translateX(-50%)',
                  animation: `thinkingBallOscillate 2.4s ease-in-out infinite`,
                  animationDelay: `${idx * 0.15}s`,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes thinkingLinesSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes thinkingBallOscillate {
          0%, 100% { top: 0px; }
          50% { top: calc(100% - ${ballSize}px); }
        }
      `}</style>
    </div>
  );
}
