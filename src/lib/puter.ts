// Puter.js — free user-pays AI: image generation (and chat fallback) with
// NO API keys in our code. Cost draws from the signed-in user's own Puter
// allowance (free monthly credits). First use opens a Puter sign-in popup.
// Docs: https://docs.puter.com/llms.txt — footer credit is required
// (see Settings → Gateway & System Status → "Powered by Puter").

export interface PuterImageResult {
  /** data-URL of the generated image (renders inline in chat markdown) */
  dataUrl: string;
  model: string;
}

interface PuterGlobal {
  ai: { txt2img: (prompt: string, options?: Record<string, unknown>) => Promise<HTMLImageElement> };
  auth: { isSignedIn: () => Promise<boolean>; signIn: () => Promise<unknown> };
}

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

const PUTER_CDN = 'https://js.puter.com/v2/';
const LOAD_TIMEOUT_MS = 20000;
let loadPromise: Promise<PuterGlobal> | null = null;

/** Lazily injects the Puter.js CDN script (singleton). Served over http(s) only. */
export function loadPuter(): Promise<PuterGlobal> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Puter needs a browser window.'));
  if (window.puter?.ai?.txt2img) return Promise.resolve(window.puter);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<PuterGlobal>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      loadPromise = null;
      reject(new Error('Puter.js took too long to load — check your connection and retry.'));
    }, LOAD_TIMEOUT_MS);
    const s = document.createElement('script');
    s.src = PUTER_CDN;
    s.async = true;
    s.onload = () => {
      window.clearTimeout(timer);
      if (window.puter?.ai?.txt2img) resolve(window.puter);
      else {
        loadPromise = null;
        reject(new Error('Puter.js loaded but did not initialise.'));
      }
    };
    s.onerror = () => {
      window.clearTimeout(timer);
      loadPromise = null;
      reject(new Error('Could not load Puter.js — check your connection and retry.'));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/** True when the user already signed in with their (free) Puter account. */
export async function puterSignedIn(): Promise<boolean> {
  try {
    const p = await loadPuter();
    return !!(await p.auth.isSignedIn());
  } catch {
    return false;
  }
}

/** Opens the Puter sign-in flow (popup on first use). Resolves true when signed in. */
export async function puterSignIn(): Promise<boolean> {
  const p = await loadPuter();
  await p.auth.signIn();
  return !!(await p.auth.isSignedIn());
}

/**
 * Paints an image from a prompt. Free tier model, low quality = fast + cheap
 * on the user's allowance. Resolves to a data-URL (no blob URLs to revoke,
 * survives chat re-renders; persistence is capped in storage.ts).
 */
export async function generateImage(prompt: string): Promise<PuterImageResult> {
  const p = await loadPuter();
  const model = 'gpt-image-1-mini';
  const img = await p.ai.txt2img(prompt, { model, quality: 'low' });
  const dataUrl = typeof img?.src === 'string' ? img.src : '';
  if (!dataUrl.startsWith('data:image')) throw new Error('Puter returned no image data.');
  return { dataUrl, model };
}

/** Human-readable message for Puter rejections (never leaks raw bodies). */
export function puterErrorMessage(e: unknown): string {
  const err = e as { message?: string; errorCode?: string; code?: string } | null;
  const msg = typeof err?.message === 'string' ? err.message : '';
  if (err?.errorCode === 'moderation_flagged' || err?.code === 'bad_request')
    return 'That prompt tripped the image safety filter. Rephrase it (simpler, non-graphic) and try again.';
  if (err?.code === 'insufficient_funds' || /insufficient_funds|402/.test(msg))
    return 'Your free Puter allowance ran out for now — it refills automatically, or top up at puter.com.';
  if (/sign.?in|auth|401|403|permission/i.test(msg))
    return 'Puter needs a free sign-in first — allow the popup, sign in, then say /imagine again.';
  if (/network|fetch|load|timeout/i.test(msg))
    return 'Could not reach Puter — check your connection and retry.';
  return (msg || 'Image generation failed — try again.').slice(0, 180);
}
