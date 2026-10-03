/**
 * MetaIoid asset manifest.
 *
 * Every image in the product is declared here with its intrinsic size, so
 * components can set `width`/`height` and never cause a layout shift, and so
 * the whole visual library can be audited in one place.
 *
 * Files under `public/` are not hashed by the bundler, therefore they are
 * resolved against `import.meta.env.BASE_URL` — the product is served from
 * `/app/`, and a bare `/art/...` path would 404 in production.
 */

const BASE = import.meta.env.BASE_URL || '/';

const url = (p: string) => `${BASE.replace(/\/$/, '')}${p}`;

export interface Asset {
  /** 1x and 2x sources. */
  src: string;
  src2x: string;
  /** Intrinsic size of the 1x file, for width/height attributes. */
  width: number;
  height: number;
}

const asset = (dir: string, name: string, width: number): Asset => ({
  src: url(`/art/${dir}/${name}-1x.webp`),
  src2x: url(`/art/${dir}/${name}-2x.webp`),
  width,
  height: width,
});

/**
 * The artwork library — one art direction, eight pieces.
 *
 * Brief: quiet intelligence. A single matte sculptural form, soft directional
 * light from the upper left, warm bone/greige ground, one restrained jade
 * note. Never a robot, a circuitry diagram, a glowing brain, or neon.
 */
export const art = {
  /** Brand atmosphere — the welcome screen's single visual moment. */
  atmosphere: asset('brand', 'atmosphere', 232),
  /** Onboarding. */
  welcome: asset('onboarding', 'welcome', 300),
  /** Empty states. */
  conversations: asset('empty-states', 'conversations', 148),
  files: asset('empty-states', 'files', 148),
  memory: asset('empty-states', 'memory', 148),
  projects: asset('empty-states', 'projects', 148),
  sources: asset('research', 'sources', 148),
  /** System states. */
  providers: asset('system', 'providers', 148),
  unavailable: asset('system', 'unavailable', 148),
} as const;

export type ArtKey = keyof typeof art;
