// Vercel's generic /api functions are addressed reliably at one path segment.
// The gateway itself is an Express application with many nested routes, so the
// project rewrites /api/:path* to this single function and carries the original
// path in a private query parameter. This adapter restores req.url before
// handing the request to the same catch-all handler used locally.

import catchAll, { config as catchAllConfig } from './[...path].js';

export const config = catchAllConfig;

const BASE = 'http://vercel.local';
const PATH_KEY = '__metaloid_path';

function restorePath(req) {
  const original = new URL(req.url || '/api/index', BASE);
  let value = req.query?.[PATH_KEY];
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string' || !value) {
    value = original.searchParams.get(PATH_KEY) || '';
  }
  if (!value) return null;

  const path = value.startsWith('/') ? value : `/${value}`;
  original.searchParams.delete(PATH_KEY);
  const query = original.searchParams.toString();
  return `/api${path}${query ? `?${query}` : ''}`;
}

export default function handler(req, res) {
  const restored = restorePath(req);
  if (restored) req.url = restored;
  return catchAll(req, res);
}
