import { MetalCubeStartup } from './animations/MetalCubeStartup';

/**
 * StartupSequence — Flagship 4-Second Metal Cube Awakening
 * Type 1: 3D Reflection Metal Cube rotating 360° for 4 seconds with engraved
 * METALOID branding, reflection floor, and precision loading progress bar.
 */
export function StartupSequence({
  onDone,
}: {
  frameSrcs?: string[];
  onDone: () => void;
}) {
  return <MetalCubeStartup onDone={onDone} />;
}
