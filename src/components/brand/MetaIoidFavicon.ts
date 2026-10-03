/**
 * MetaIoidFavicon — Manages dynamic favicon and page title updates.
 *
 * Asset URLs are derived from Vite's BASE_URL so the product keeps working
 * when it is served from a sub-path (/app/) instead of a domain root.
 */
const asset = (file: string): string => {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
  return `${base.replace(/\/$/, '')}${file}`;
};

export class MetaIoidFavicon {
  static setLive(isLive = true): void {
    if (typeof document === 'undefined') return;
    const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
    if (link) {
      link.href = isLive ? asset('/favicon.png') : asset('/brand/metaloid-mark.png');
    }
  }

  static setDocumentTitle(subtitle?: string): void {
    if (typeof document === 'undefined') return;
    if (!subtitle) {
      document.title = 'MetaIoid — Autonomous Frontier Intelligence';
    } else {
      document.title = `MetaIoid — ${subtitle}`;
    }
  }
}
