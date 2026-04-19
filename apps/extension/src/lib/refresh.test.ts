import { describe, it, expect, afterEach, vi } from 'vitest';
import { refreshSupabaseSession, tokenNeedsRefresh, RefreshError } from './refresh';

const ORIG_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = vi.fn(impl) as any;
}

describe('tokenNeedsRefresh', () => {
  it('returns false when no expiresAt is known (unknown expiry → trust)', () => {
    expect(tokenNeedsRefresh(undefined)).toBe(false);
  });

  it('returns true when the token is within the default 60s skew', () => {
    const now = 1_000_000;
    expect(tokenNeedsRefresh(now + 30, now)).toBe(true);
  });

  it('returns false when the token has plenty of life', () => {
    const now = 1_000_000;
    expect(tokenNeedsRefresh(now + 600, now)).toBe(false);
  });

  it('honors a custom skew', () => {
    const now = 1_000_000;
    expect(tokenNeedsRefresh(now + 200, now, 300)).toBe(true);
    expect(tokenNeedsRefresh(now + 400, now, 300)).toBe(false);
  });
});

describe('refreshSupabaseSession', () => {
  const opts = {
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'anon-key',
    refreshToken: 'refresh-old',
  };

  it('POSTs to /auth/v1/token with the refresh_token and anon apikey', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> | undefined;
    let seenBody = '';
    stubFetch(async (url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers as Record<string, string>;
      seenBody = (init?.body as string) ?? '';
      return new Response(
        JSON.stringify({
          access_token: 'at-new',
          refresh_token: 'rt-new',
          expires_at: 1_234_567_890,
        }),
        { status: 200 },
      );
    });
    const out = await refreshSupabaseSession(opts);
    expect(seenUrl).toBe('https://project.supabase.co/auth/v1/token?grant_type=refresh_token');
    expect(seenHeaders?.apikey).toBe('anon-key');
    expect(seenBody).toContain('"refresh_token":"refresh-old"');
    expect(out).toEqual({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresAt: 1_234_567_890,
    });
  });

  it('keeps the old refresh token if the server doesn\u2019t return a new one', async () => {
    stubFetch(async () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }));
    const out = await refreshSupabaseSession(opts);
    expect(out.refreshToken).toBe('refresh-old');
    // expires_at derived from expires_in + now — should be within a few seconds of now+3600.
    const now = Math.floor(Date.now() / 1_000);
    expect(out.expiresAt).toBeGreaterThanOrEqual(now + 3590);
    expect(out.expiresAt).toBeLessThanOrEqual(now + 3610);
  });

  it('throws RefreshError on non-2xx', async () => {
    stubFetch(async () => new Response('bad', { status: 400 }));
    await expect(refreshSupabaseSession(opts)).rejects.toBeInstanceOf(RefreshError);
  });

  it('throws RefreshError when the body lacks access_token', async () => {
    stubFetch(async () => new Response(JSON.stringify({ not_what: 'you expect' }), { status: 200 }));
    await expect(refreshSupabaseSession(opts)).rejects.toBeInstanceOf(RefreshError);
  });
});
