import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthStore, type DesktopSession } from './auth-store';

async function freshDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ic-auth-store-'));
  return dir;
}

const FAKE_SESSION: DesktopSession = {
  userId: 'uuid-1',
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  expiresAt: 9_999_999_999,
  email: 'user@example.com',
};

describe('AuthStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await freshDir();
  });

  it('returns undefined on first run when the file does not exist', async () => {
    const store = new AuthStore({ userDataDir: dir });
    await store.load();
    expect(store.getSession()).toBeUndefined();
    expect(store.getPendingState()).toBeUndefined();
  });

  it('throws if used before load()', () => {
    const store = new AuthStore({ userDataDir: dir });
    expect(() => store.getSession()).toThrow(/load\(\)/);
  });

  it('round-trips a session through the filesystem', async () => {
    const writer = new AuthStore({ userDataDir: dir });
    await writer.load();
    await writer.setSession(FAKE_SESSION);

    const reader = new AuthStore({ userDataDir: dir });
    await reader.load();
    expect(reader.getSession()).toEqual(FAKE_SESSION);
  });

  it('expires pendingState lazily on read', async () => {
    const store = new AuthStore({ userDataDir: dir });
    await store.load();
    await store.setPendingState('nonce-1', 1); // 1ms TTL
    // Force a sleep past the TTL.
    await new Promise((r) => setTimeout(r, 5));
    expect(store.getPendingState()).toBeUndefined();
  });

  it('clears pendingState when a session is accepted', async () => {
    const store = new AuthStore({ userDataDir: dir });
    await store.load();
    await store.setPendingState('nonce-2', 60_000);
    await store.setSession(FAKE_SESSION);
    expect(store.getPendingState()).toBeUndefined();
    expect(store.getSession()).toEqual(FAKE_SESSION);
  });

  it('recovers gracefully when the file is corrupt', async () => {
    await fs.writeFile(path.join(dir, 'auth.json'), 'not json {{{', 'utf8');
    const store = new AuthStore({ userDataDir: dir });
    await store.load();
    expect(store.getSession()).toBeUndefined();
    // And is still usable for a fresh write.
    await store.setSession(FAKE_SESSION);
    expect(store.getSession()).toEqual(FAKE_SESSION);
  });

  it('clearSession leaves pendingState untouched', async () => {
    const store = new AuthStore({ userDataDir: dir });
    await store.load();
    await store.setSession(FAKE_SESSION);
    await store.setPendingState('nonce-3', 60_000);
    await store.clearSession();
    expect(store.getSession()).toBeUndefined();
    expect(store.getPendingState()?.nonce).toBe('nonce-3');
  });
});
