// Repository for account data.
//
// The ONE place the app talks to the MetaIoid API for user data. Screens and
// stores never call fetch directly and never touch Supabase tables — which is
// also what keeps the future Android client able to use the same contract
// (documented in docs/ANDROID_API.md).
//
// Every call carries the access token from the auth layer. Identity is
// decided server-side from that token; nothing here sends a user id, because
// the server would (rightly) ignore it.

import { API_URL } from './transport';

export interface ApiError { message: string; code: string; status: number }

/** Where account data lives. Loopback default, same-origin when proxied. */
function base(configuredUrl?: string): string {
  const explicit = (configuredUrl || '').trim().replace(/\/$/, '');
  return explicit || API_URL;
}

export class RepoError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'error', status = 0) {
    super(message);
    this.name = 'RepoError';
    this.code = code;
    this.status = status;
  }
}

async function call<T>(
  path: string,
  opts: { token: string | null; method?: string; body?: unknown; baseUrl?: string; signal?: AbortSignal }
): Promise<T> {
  if (!opts.token) throw new RepoError('Sign in to sync your data.', 'no_token', 401);
  let res: Response;
  try {
    res = await fetch(`${base(opts.baseUrl)}/api/v1${path}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch {
    throw new RepoError('Cannot reach the MetaIoid gateway.', 'offline', 0);
  }
  const text = await res.text();
  let json: { error?: string; code?: string } & Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    throw new RepoError(json.error || `Request failed (${res.status})`, json.code || 'http_error', res.status);
  }
  return json as T;
}

// ── types (mirrors of the API contract) ─────────────────────────────────
export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
  preferred_provider: string | null;
  preferred_model: string | null;
  theme: string;
  voice_preference: string;
  memory_preference: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationRow {
  id: string; user_id: string; title: string; model: string | null; provider: string | null;
  archived: boolean; created_at: string; updated_at: string;
}

export interface MessageRow {
  id: string; conversation_id: string; user_id: string; role: 'user' | 'assistant' | 'tool' | 'system';
  content: string; model: string | null; provider: string | null;
  status: 'streaming' | 'complete' | 'cancelled' | 'error'; error_code: string | null;
  created_at: string;
}

export interface MemoryRow {
  id: string; user_id: string; content: string; category: string; kind: string;
  pinned: boolean; created_at: string; updated_at: string;
}

export interface CredentialRow {
  id: string; provider: string; label: string; masked: string | null;
  status: 'unverified' | 'connected' | 'invalid';
  key_version: string; last_checked_at: string | null; updated_at: string;
}

export interface ProviderSettingsRow {
  user_id: string; default_provider: string | null; default_model: string | null;
  fallback_enabled: boolean; free_only: boolean; updated_at: string;
}

export interface Page<T> { rows: T[]; next_cursor: string | null }

export interface AttachmentRow {
  id: string; conversation_id: string | null; bucket: string; storage_path: string;
  filename: string; mime_type: string; size_bytes: number; status: string; created_at: string;
}

export interface TaskRow {
  id: string; type: string; objective: string; status: string; progress: number;
  result: unknown; error: string | null; created_at: string; updated_at: string; completed_at: string | null;
}

// ── api ─────────────────────────────────────────────────────────────────
export const repo = {
  // profile / onboarding
  me: (token: string | null, baseUrl?: string) =>
    call<{ user: { id: string; email: string | null }; profile: Profile }>('/me', { token, baseUrl }),

  updateProfile: (token: string | null, patch: Partial<Pick<Profile,
    'display_name' | 'avatar_url' | 'onboarding_completed' | 'preferred_provider' |
    'preferred_model' | 'theme' | 'voice_preference' | 'memory_preference'>>, baseUrl?: string) =>
    call<{ profile: Profile }>('/me', { token, method: 'PATCH', body: patch, baseUrl }),

  deleteAccount: (token: string | null, baseUrl?: string) =>
    call<{ deleted: boolean }>('/me', { token, method: 'DELETE', body: { confirm: 'DELETE' }, baseUrl }),

  // conversations
  listConversations: (token: string | null, opts: { limit?: number; cursor?: string | null } = {}, baseUrl?: string) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.cursor) q.set('cursor', opts.cursor);
    const qs = q.toString();
    return call<Page<ConversationRow>>(`/conversations${qs ? `?${qs}` : ''}`, { token, baseUrl });
  },
  createConversation: (token: string | null, body: { title?: string; model?: string | null; provider?: string | null } = {}, baseUrl?: string) =>
    call<{ conversation: ConversationRow }>('/conversations', { token, method: 'POST', body, baseUrl }),
  renameConversation: (token: string | null, id: string, title: string, baseUrl?: string) =>
    call<{ conversation: ConversationRow }>(`/conversations/${id}`, { token, method: 'PATCH', body: { title }, baseUrl }),
  deleteConversation: (token: string | null, id: string, baseUrl?: string) =>
    call<{ deleted: boolean }>(`/conversations/${id}`, { token, method: 'DELETE', baseUrl }),

  // messages
  listMessages: (token: string | null, conversationId: string, opts: { limit?: number; cursor?: string | null } = {}, baseUrl?: string) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.cursor) q.set('cursor', opts.cursor);
    const qs = q.toString();
    return call<Page<MessageRow>>(`/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`, { token, baseUrl });
  },
  appendMessage: (
    token: string | null,
    conversationId: string,
    body: { role: 'user' | 'assistant' | 'tool' | 'system'; content: string; model?: string | null; provider?: string | null; status?: string; metadata?: Record<string, unknown> },
    baseUrl?: string
  ) => call<{ message: MessageRow }>(`/conversations/${conversationId}/messages`, { token, method: 'POST', body, baseUrl }),
  updateMessage: (token: string | null, id: string, patch: { content?: string; status?: string; error_code?: string | null; tokens?: number; latency_ms?: number }, baseUrl?: string) =>
    call<{ message: MessageRow }>(`/messages/${id}`, { token, method: 'PATCH', body: patch, baseUrl }),
  recoverMessages: (token: string | null, conversationId: string, baseUrl?: string) =>
    call<{ recovered: number }>(`/conversations/${conversationId}/messages/recover`, { token, method: 'POST', baseUrl }),

  // memories
  listMemories: (token: string | null, opts: { limit?: number; cursor?: string | null; kind?: string; q?: string } = {}, baseUrl?: string) => {
    const s = new URLSearchParams();
    if (opts.limit) s.set('limit', String(opts.limit));
    if (opts.cursor) s.set('cursor', opts.cursor);
    if (opts.kind) s.set('kind', opts.kind);
    if (opts.q) s.set('q', opts.q);
    const qs = s.toString();
    return call<Page<MemoryRow>>(`/memories${qs ? `?${qs}` : ''}`, { token, baseUrl });
  },
  createMemory: (token: string | null, body: { content: string; category?: string; kind?: string; pinned?: boolean }, baseUrl?: string) =>
    call<{ memory: MemoryRow }>('/memories', { token, method: 'POST', body, baseUrl }),
  updateMemory: (token: string | null, id: string, patch: Partial<Pick<MemoryRow, 'content' | 'category' | 'kind' | 'pinned'>>, baseUrl?: string) =>
    call<{ memory: MemoryRow }>(`/memories/${id}`, { token, method: 'PATCH', body: patch, baseUrl }),
  deleteMemory: (token: string | null, id: string, baseUrl?: string) =>
    call<{ deleted: boolean }>(`/memories/${id}`, { token, method: 'DELETE', baseUrl }),

  // provider configuration
  getProviderSettings: (token: string | null, baseUrl?: string) =>
    call<{ settings: ProviderSettingsRow | null }>('/provider/settings', { token, baseUrl }),
  saveProviderSettings: (token: string | null, patch: Partial<Pick<ProviderSettingsRow, 'default_provider' | 'default_model' | 'fallback_enabled' | 'free_only'>>, baseUrl?: string) =>
    call<{ settings: ProviderSettingsRow }>('/provider/settings', { token, method: 'PUT', body: patch, baseUrl }),
  listCredentials: (token: string | null, baseUrl?: string) =>
    call<{ credentials: CredentialRow[] }>('/provider/credentials', { token, baseUrl }),
  saveCredential: (token: string | null, provider: string, apiKey: string, label = 'default', baseUrl?: string) =>
    call<{ credential: CredentialRow }>(`/provider/credentials/${provider}`, {
      token, method: 'PUT', body: { api_key: apiKey, label }, baseUrl,
    }),
  testCredential: (token: string | null, provider: string, opts: { apiKey?: string; label?: string } = {}, baseUrl?: string) =>
    call<{ ok: boolean; status: string; detail: string; latency_ms: number }>(`/provider/credentials/${provider}/test`, {
      token, method: 'POST', body: { api_key: opts.apiKey, label: opts.label }, baseUrl,
    }),
  deleteCredential: (token: string | null, provider: string, label = 'default', baseUrl?: string) =>
    call<{ deleted: boolean }>(`/provider/credentials/${provider}?label=${encodeURIComponent(label)}`, { token, method: 'DELETE', baseUrl }),

  // usage + tasks
  listUsage: (token: string | null, opts: { limit?: number; cursor?: string | null } = {}, baseUrl?: string) =>
    call<Page<{ id: string; provider: string | null; model: string | null; latency_ms: number | null; status: string; created_at: string }>>(
      `/usage${opts.limit ? `?limit=${opts.limit}` : ''}${opts.cursor ? `${opts.limit ? '&' : '?'}cursor=${encodeURIComponent(opts.cursor)}` : ''}`,
      { token, baseUrl }
    ),
  listTasks: (token: string | null, baseUrl?: string) => call<Page<TaskRow>>('/tasks', { token, baseUrl }),
  createTask: (token: string | null, body: { type: string; objective?: string; conversation_id?: string | null }, baseUrl?: string) =>
    call<{ task: TaskRow }>('/tasks', { token, method: 'POST', body, baseUrl }),
  updateTask: (token: string | null, id: string, patch: Partial<Pick<TaskRow, 'status' | 'progress' | 'error'>>, baseUrl?: string) =>
    call<{ task: TaskRow }>(`/tasks/${id}`, { token, method: 'PATCH', body: patch, baseUrl }),

  // attachments
  listAttachments: (token: string | null, conversationId?: string, baseUrl?: string) =>
    call<Page<AttachmentRow>>(`/attachments${conversationId ? `?conversation_id=${conversationId}` : ''}`, { token, baseUrl }),
  createAttachment: (token: string | null, body: { filename: string; mime_type?: string; size_bytes?: number; conversation_id?: string | null }, baseUrl?: string) =>
    call<{ attachment: AttachmentRow; upload: { bucket: string; path: string } }>('/attachments', { token, method: 'POST', body, baseUrl }),
  attachmentUrl: (token: string | null, id: string, expires = 300, baseUrl?: string) =>
    call<{ url: string; expires_in: number }>(`/attachments/${id}/url?expires=${expires}`, { token, baseUrl }),
  deleteAttachment: (token: string | null, id: string, baseUrl?: string) =>
    call<{ deleted: boolean }>(`/attachments/${id}`, { token, method: 'DELETE', baseUrl }),
};
