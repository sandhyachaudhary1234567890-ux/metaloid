/**
 * MetaIoidFavicon — Manages dynamic favicon and page title updates.
 */
export class MetaIoidFavicon {
  static setLive(isLive = true): void {
    if (typeof document === 'undefined') return;
    const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
    if (link) {
      link.href = isLive ? '/favicon.png' : '/brand/metaloid-mark.png';
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
