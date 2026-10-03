/**
 * Resolves a path inside `public/` against the app's base URL.
 *
 * The product is served from `/app/` (the marketing page owns the domain
 * root), so a root-relative `"/brand/logo.png"` resolves to a directory that
 * does not exist and 404s. Vite rewrites absolute paths inside `index.html`
 * at build time, but it cannot see paths that only exist inside JavaScript —
 * which is exactly how the brand mark and wordmark were breaking.
 *
 * Every runtime asset URL in the app must go through this.
 */
export function publicAsset(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
