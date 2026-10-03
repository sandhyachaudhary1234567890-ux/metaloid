// Repository + auth contract for the account layer.
//
// The gateway tests already prove the server enforces ownership. These tests
// pin the CLIENT side of the same rules:
//   * no call goes out without a bearer token
//   * a user id is never sent in a body (the server ignores it; we must not
//     rely on that)
//   * provider keys are sent once and never requested back
//   * server error codes reach the caller intact, so the UI can be specific

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repo, RepoError } from './repo';

const TOKEN = 'test.jwt.token';

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(handler(String(url), init));
  }));
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('repo — auth boundary', () => {
  it('refuses to call the API without a session', async () => {
    mockFetch(() => json({}));
    await expect(repo.listConversations(null)).rejects.toMatchObject({ code: 'no_token' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('attaches the bearer token and never a user id in the body', async () => {
    const calls = mockFetch(() => json({ conversation: { id: 'c1' } }));
    await repo.createConversation(TOKEN, { title: 'hello' });
    const [call] = calls;
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(String(call.init.body)).not.toMatch(/user_id/);
  });

  it('maps a gateway error to a typed RepoError with its code', async () => {
    mockFetch(() => json({ error: 'Conversation not found.', code: 'not_found' }, 404));
    await expect(repo.listMessages(TOKEN, 'c1')).rejects.toMatchObject({
      message: 'Conversation not found.', code: 'not_found', status: 404,
    });
  });

  it('reports an unreachable gateway as offline instead of throwing something opaque', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    let err: unknown = null;
    try { await repo.me(TOKEN); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RepoError);
    expect((err as RepoError).code).toBe('offline');
  });
});

describe('repo — provider credentials', () => {
  it('sends the raw key exactly once, upward only', async () => {
    const calls = mockFetch(() => json({ credential: { id: 'k1', provider: 'openrouter', masked: '…abcd', status: 'unverified' } }, 201));
    const res = await repo.saveCredential(TOKEN, 'openrouter', 'sk-or-v1-secret-value');
    expect(JSON.stringify(calls[0].init.body)).toContain('sk-or-v1-secret-value');
    expect(res.credential).not.toHaveProperty('api_key');
    expect(JSON.stringify(res)).not.toContain('sk-or-v1-secret-value');
  });

  it('lists credentials as masks only', async () => {
    mockFetch(() => json({
      credentials: [{ id: 'k1', provider: 'openrouter', label: 'default', masked: '…f3a9', status: 'connected', key_version: 'k1' }],
    }));
    const { credentials } = await repo.listCredentials(TOKEN);
    expect(credentials[0].masked).toBe('…f3a9');
    const serialized = JSON.stringify(credentials);
    expect(serialized).not.toMatch(/secret_ciphertext|api_key|sk-or-/);
  });

  it('surfaces the encryption-unconfigured refusal verbatim', async () => {
    mockFetch(() => json({
      error: 'Server encryption is not configured (METALOID_ENCRYPTION_KEYS); refusing to store a key in the clear.',
      code: 'encryption_unconfigured',
    }, 503));
    await expect(repo.saveCredential(TOKEN, 'openrouter', 'sk-or-v1-whatever-value'))
      .rejects.toMatchObject({ code: 'encryption_unconfigured', status: 503 });
  });
});

describe('repo — endpoints the Android client will reuse', () => {
  it('uses cursor pagination for conversations', async () => {
    const calls = mockFetch(() => json({ rows: [], next_cursor: 'abc' }));
    const page = await repo.listConversations(TOKEN, { limit: 20, cursor: 'prev' });
    expect(calls[0].url).toContain('limit=20');
    expect(calls[0].url).toContain('cursor=prev');
    expect(page.next_cursor).toBe('abc');
  });

  it('confirms account deletion explicitly', async () => {
    const calls = mockFetch(() => json({ deleted: true }));
    await repo.deleteAccount(TOKEN);
    expect(calls[0].init.method).toBe('DELETE');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ confirm: 'DELETE' });
  });

  it('requests a signed URL with a bounded expiry', async () => {
    const calls = mockFetch(() => json({ url: 'https://signed.example/x', expires_in: 300 }));
    await repo.attachmentUrl(TOKEN, 'a1', 300);
    expect(calls[0].url).toContain('/attachments/a1/url?expires=300');
  });
});
