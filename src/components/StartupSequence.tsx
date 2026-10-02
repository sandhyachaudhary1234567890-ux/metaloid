import { MetaIoidBoot } from './animations/MetaIoidBoot';

/**
 * StartupSequence — Flagship MetaIoid Awakening
 * 5-stage progressive reveal: Dark canvas -> Brand mark -> Real capability checks
 * -> LIVE state ("METAIOID | ● LIVE", "Ready · Listening for you") -> Seamless handoff.
 */
export function StartupSequence({
  onDone,
}: {
  frameSrcs?: string[];
  onDone: () => void;
}) {
  return <MetaIoidBoot onDone={onDone} />;
}
