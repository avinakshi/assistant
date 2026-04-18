import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SttRouter } from './router';
import type { SttConnectOptions, SttProvider, SttSession } from './provider';

function fakeSession(name: string): SttSession {
  return {
    providerName: name,
    pushFrame: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeProvider(
  name: string,
  behavior: (opts: SttConnectOptions) => Promise<SttSession>,
): SttProvider {
  return { name, connect: behavior };
}

function baseOpts(overrides: Partial<SttConnectOptions> = {}): SttConnectOptions {
  return {
    language: 'en',
    sampleRateHz: 16000,
    onPartial: vi.fn(),
    onFinal: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('SttRouter', () => {
  let now = 0;
  beforeEach(() => {
    now = 1_700_000_000_000;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes to primary on first connect', async () => {
    const primary = fakeProvider('primary', async () => fakeSession('primary'));
    const fallback = fakeProvider('fallback', async () => fakeSession('fallback'));
    const router = new SttRouter({ primary, fallback, now: () => now });

    const session = await router.connect(baseOpts());
    expect(session.providerName).toBe('primary');
    expect(router.currentProviderName).toBe('primary');
  });

  it('fails over to fallback after 3 primary 5xx errors inside 60s window', async () => {
    // Primary fires onError with UPSTREAM_5XX (no double-count), then throws so connect() fails.
    const primary: SttProvider = {
      name: 'primary',
      connect: async (opts) => {
        opts.onError({ code: 'UPSTREAM_5XX', message: 'upstream 5xx', statusCode: 500 });
        throw new Error('simulated 5xx');
      },
    };
    const fallback = fakeProvider('fallback', async () => fakeSession('fallback'));

    const router = new SttRouter({
      primary,
      fallback,
      now: () => now,
      failureThreshold: 3,
      failureWindowMs: 60_000,
    });

    for (let i = 0; i < 2; i++) {
      await expect(router.connect(baseOpts())).rejects.toThrow();
      expect(router.currentProviderName).toBe('primary');
      now += 100;
    }
    await expect(router.connect(baseOpts())).rejects.toThrow();
    expect(router.currentProviderName).toBe('fallback');

    const session = await router.connect(baseOpts());
    expect(session.providerName).toBe('fallback');
  });

  it('drops failures outside the 60s window — transient hiccups do not flip the switch', async () => {
    const primary = fakeProvider('primary', async () => fakeSession('primary'));
    const fallback = fakeProvider('fallback', async () => fakeSession('fallback'));
    const router = new SttRouter({
      primary,
      fallback,
      now: () => now,
      failureThreshold: 3,
      failureWindowMs: 60_000,
    });

    router['recordFailure']({ code: 'UPSTREAM_5XX', message: 'x' });
    router['recordFailure']({ code: 'UPSTREAM_5XX', message: 'x' });
    now += 120_000; // 2 minutes later
    router['recordFailure']({ code: 'UPSTREAM_5XX', message: 'x' });
    expect(router.currentProviderName).toBe('primary');
  });

  it('ignores non-5xx / non-network failures (e.g. 4xx is a client bug, not an outage)', async () => {
    const primary = fakeProvider('primary', async () => fakeSession('primary'));
    const fallback = fakeProvider('fallback', async () => fakeSession('fallback'));
    const router = new SttRouter({
      primary,
      fallback,
      now: () => now,
      failureThreshold: 3,
      failureWindowMs: 60_000,
    });
    router['recordFailure']({ code: 'UPSTREAM_4XX', message: 'x' });
    router['recordFailure']({ code: 'AUTH', message: 'x' });
    router['recordFailure']({ code: 'UPSTREAM_4XX', message: 'x' });
    expect(router.currentProviderName).toBe('primary');
  });
});
