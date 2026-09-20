export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function groupConversations<T extends { createdAt: number }>(list: T[]): { label: string; items: T[] }[] {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  const startWeek = startToday - 86400000 * 7;
  const today = list.filter((c) => c.createdAt >= startToday);
  const yesterday = list.filter((c) => c.createdAt >= startYesterday && c.createdAt < startToday);
  const week = list.filter((c) => c.createdAt >= startWeek && c.createdAt < startYesterday);
  const older = list.filter((c) => c.createdAt < startWeek);
  const out: { label: string; items: T[] }[] = [];
  if (today.length) out.push({ label: 'Today', items: today });
  if (yesterday.length) out.push({ label: 'Yesterday', items: yesterday });
  if (week.length) out.push({ label: 'Previous 7 days', items: week });
  if (older.length) out.push({ label: 'Older', items: older });
  return out;
}
