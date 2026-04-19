import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchUserPrefs } from './prefs';

const ORIG_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = vi.fn(impl) as any;
}

describe('fetchUserPrefs', () => {
  it('returns defaults when no token is provided', async () => {
    stubFetch(() => {
      throw new Error('fetch should not be called');
    });
    const prefs = await fetchUserPrefs({ apiBaseUrl: 'http://api', token: undefined });
    expect(prefs.persistTranscriptsDefault).toBe(true);
  });

  it('sends the token as a Bearer header and parses a valid response', async () => {
    let seenAuth: string | undefined;
    stubFetch(async (_url, init) => {
      seenAuth = (init?.headers as Record<string, string> | undefined)?.authorization;
      return new Response(JSON.stringify({ persistTranscriptsDefault: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const prefs = await fetchUserPrefs({ apiBaseUrl: 'http://api', token: 'jwt.body.sig' });
    expect(seenAuth).toBe('Bearer jwt.body.sig');
    expect(prefs.persistTranscriptsDefault).toBe(false);
  });

  it('strips a trailing slash from the base URL', async () => {
    let seenUrl = '';
    stubFetch(async (url) => {
      seenUrl = url;
      return new Response('{"persistTranscriptsDefault":true}', { status: 200 });
    });
    await fetchUserPrefs({ apiBaseUrl: 'http://api/', token: 'jwt' });
    expect(seenUrl).toBe('http://api/api/prefs');
  });

  it('falls back to defaults on non-200', async () => {
    stubFetch(async () => new Response('{}', { status: 500 }));
    const prefs = await fetchUserPrefs({ apiBaseUrl: 'http://api', token: 'jwt' });
    expect(prefs.persistTranscriptsDefault).toBe(true);
  });

  it('falls back to defaults on a malformed body', async () => {
    stubFetch(async () => new Response('null', { status: 200 }));
    const prefs = await fetchUserPrefs({ apiBaseUrl: 'http://api', token: 'jwt' });
    expect(prefs.persistTranscriptsDefault).toBe(true);
  });

  it('falls back to defaults when the response is missing the field', async () => {
    stubFetch(async () => new Response('{"somethingElse":42}', { status: 200 }));
    const prefs = await fetchUserPrefs({ apiBaseUrl: 'http://api', token: 'jwt' });
    expect(prefs.persistTranscriptsDefault).toBe(true);
  });

  it('falls back to defaults when fetch throws (network error)', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const prefs = await fetchUserPrefs({ apiBaseUrl: 'http://api', token: 'jwt' });
    expect(prefs.persistTranscriptsDefault).toBe(true);
  });

  it('honors explicit false from the server', async () => {
    stubFetch(async () => new Response('{"persistTranscriptsDefault":false}', { status: 200 }));
    const prefs = await fetchUserPrefs({ apiBaseUrl: 'http://api', token: 'jwt' });
    expect(prefs.persistTranscriptsDefault).toBe(false);
  });
});
