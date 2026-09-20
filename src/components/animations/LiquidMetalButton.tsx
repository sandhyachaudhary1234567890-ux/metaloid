import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Square, Check } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * LiquidMetalButton — Liquid Metal Button Component (liquid-metal-button)
 * Features an interactive mercury/liquid-metal fluid surface with chrome outline,
 * specular reflection, and tactile state feedback.
 */
export function LiquidMetalButton({
  onClick,
  disabled = false,
  isGenerating = false,
  size = 36,
  className = '',
  title = 'Send message',
  icon,
}: {
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  isGenerating?: boolean;
  size?: number;
  className?: string;
  title?: string;
  icon?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);

  // Render fluid liquid-metal ripples on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrame: number;
    let t = 0;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) / 2 - 1;

      // Base liquid chrome gradient
      const angle = (t * 0.03) % (Math.PI * 2);
      const gx = cx + Math.cos(angle) * r * 0.7;
      const gy = cy + Math.sin(angle) * r * 0.7;

      const grad = ctx.createRadialGradient(gx, gy, 2, cx, cy, r);
      if (disabled) {
        grad.addColorStop(0, '#2d333b');
        grad.addColorStop(0.5, '#1e2228');
        grad.addColorStop(1, '#16191d');
      } else if (isGenerating) {
        grad.addColorStop(0, '#ef4444');
        grad.addColorStop(0.5, '#991b1b');
        grad.addColorStop(1, '#450a0a');
      } else {
        // Vibrant titanium teal liquid metal
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(0.35, '#0ea5e9');
        grad.addColorStop(0.7, '#0284c7');
        grad.addColorStop(1, '#0369a1');
      }

      // Clip circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Mercury wave perturbation
      if (!disabled) {
        const waves = hovered ? 4 : 2;
        const speed = hovered ? 0.08 : 0.04;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2; a += 0.1) {
          const waveRadius = r * 0.75 + Math.sin(a * waves + t * speed) * (hovered ? 4 : 2);
          const px = cx + Math.cos(a) * waveRadius;
          const py = cy + Math.sin(a) * waveRadius;
          if (a === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // Specular highlight crescent
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.25, cy - r * 0.3, r * 0.35, r * 0.15, -Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Metallic rim stroke
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = disabled
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      t += 1;
      animFrame = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, [disabled, hovered, isGenerating]);

  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.05 } : {}}
      whileTap={!disabled ? { scale: 0.93 } : {}}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      title={title}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full overflow-hidden transition-all shrink-0',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer shadow-md',
        className
      )}
      style={{
        width: size,
        height: size,
        boxShadow: disabled ? 'none' : '0 2px 10px rgba(14, 165, 233, 0.35), inset 0 1px 1px rgba(255,255,255,0.4)',
      }}
    >
      {/* Fluid canvas */}
      <canvas
        ref={canvasRef}
        width={size * 2}
        height={size * 2}
        className="absolute inset-0 w-full h-full pointer-events-none rounded-full"
      />

      {/* Button content / Icon */}
      <span className="relative z-10 text-white flex items-center justify-center drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
        {icon ? (
          icon
        ) : isGenerating ? (
          <Square size={Math.round(size * 0.38)} fill="currentColor" />
        ) : (
          <Send size={Math.round(size * 0.4)} />
        )}
      </span>
    </motion.button>
  );
}
