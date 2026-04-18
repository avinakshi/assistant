import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthStore } from './auth-store';
import {
  beginLogin,
  parseCallbackUrl,
  completeLogin,
  CallbackParseError,
  CallbackAuthError,
} from './login-flow';

async function freshStore(): Promise<AuthStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ic-login-flow-'));
  const store = new AuthStore({ userDataDir: dir });
  await store.load();
  return store;
}

describe('beginLogin', () => {
  it('stores a fresh nonce and builds the web URL with from+state', async () => {
    const store = await freshStore();
    const { nonce, browserUrl } = await beginLogin({
      authStore: store,
      webBaseUrl: 'https://example.com',
    });
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);

    const url = new URL(browserUrl);
    expect(url.origin).toBe('https://example.com');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('from')).toBe('desktop');
    expect(url.searchParams.get('state')).toBe(nonce);
    expect(store.getPendingState()?.nonce).toBe(nonce);
  });

  it('emits a different nonce on each call (no collision)', async () => {
    const store = await freshStore();
    const a = await beginLogin({ authStore: store, webBaseUrl: 'https://example.com' });
    const b = await beginLogin({ authStore: store, webBaseUrl: 'https://example.com' });
    expect(a.nonce).not.toBe(b.nonce);
    // The latest beginLogin wins — store holds the newer pending state.
    expect(store.getPendingState()?.nonce).toBe(b.nonce);
  });
});

describe('parseCallbackUrl', () => {
  const good =
    'ic://auth-callback' +
    '?state=abc&access_token=jwt-access&refresh_token=ref-xyz' +
    '&expires_at=9999999999&user_id=uuid-1&email=u%40e.com';

  it('parses a well-formed callback URL', () => {
    const out = parseCallbackUrl(good);
    expect(out).toEqual({
      state: 'abc',
      accessToken: 'jwt-access',
      refreshToken: 'ref-xyz',
      expiresAt: 9_999_999_999,
      userId: 'uuid-1',
      email: 'u@e.com',
    });
  });

  it('rejects the wrong scheme', () => {
    expect(() => parseCallbackUrl('https://example.com/auth-callback?state=a'))
      .toThrow(CallbackParseError);
  });

  it('rejects the wrong host', () => {
    const bad = 'ic://something-else?state=a&access_token=b&refresh_token=c&expires_at=1&user_id=d';
    try {
      parseCallbackUrl(bad);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CallbackParseError);
      expect((err as CallbackParseError).reason).toBe('wrong-host');
    }
  });

  it('rejects when required fields are missing', () => {
    const bad = 'ic://auth-callback?state=a&access_token=b';
    try {
      parseCallbackUrl(bad);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CallbackParseError);
      expect((err as CallbackParseError).reason).toBe('missing-field');
    }
  });

  it('accepts ISO 8601 for expires_at as a fallback', () => {
    const iso = encodeURIComponent('2099-01-01T00:00:00Z');
    const url = `ic://auth-callback?state=a&access_token=b&refresh_token=c&expires_at=${iso}&user_id=d`;
    const out = parseCallbackUrl(url);
    expect(out.expiresAt).toBeGreaterThan(Math.floor(Date.parse('2098-12-31T00:00:00Z') / 1000));
  });

  it('rejects a totally malformed URL', () => {
    expect(() => parseCallbackUrl('not a url')).toThrow(CallbackParseError);
  });
});

describe('completeLogin', () => {
  let store: AuthStore;
  beforeEach(async () => {
    store = await freshStore();
  });

  const mkCallback = (overrides: Partial<ReturnType<typeof parseCallbackUrl>>) => ({
    state: 'n',
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    userId: 'u',
    email: 'u@e.com',
    ...overrides,
  });

  it('rejects when no login is pending', async () => {
    const cb = mkCallback({});
    await expect(
      completeLogin({ authStore: store, callback: cb }),
    ).rejects.toThrow(CallbackAuthError);
  });

  it('rejects when state does not match', async () => {
    await store.setPendingState('expected-nonce', 60_000);
    const cb = mkCallback({ state: 'wrong-nonce' });
    try {
      await completeLogin({ authStore: store, callback: cb });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CallbackAuthError);
      expect((err as CallbackAuthError).reason).toBe('state-mismatch');
    }
    // The pending state must be cleared so a second replay fails too.
    expect(store.getPendingState()).toBeUndefined();
  });

  it('rejects when the token is already expired', async () => {
    await store.setPendingState('n', 60_000);
    const cb = mkCallback({ state: 'n', expiresAt: Math.floor(Date.now() / 1000) - 10 });
    try {
      await completeLogin({ authStore: store, callback: cb });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CallbackAuthError);
      expect((err as CallbackAuthError).reason).toBe('expired');
    }
  });

  it('accepts a valid callback and stores the session', async () => {
    await store.setPendingState('n', 60_000);
    const cb = mkCallback({ state: 'n' });
    const session = await completeLogin({ authStore: store, callback: cb });
    expect(session.userId).toBe('u');
    expect(session.email).toBe('u@e.com');
    expect(store.getSession()).toEqual(session);
    // pending state should be cleared.
    expect(store.getPendingState()).toBeUndefined();
  });
});
