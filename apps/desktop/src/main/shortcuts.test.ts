import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registerMock = vi.fn<(accel: string, fn: () => void) => boolean>();
const unregisterAllMock = vi.fn<() => void>();

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accel: string, fn: () => void) => registerMock(accel, fn),
    unregisterAll: () => unregisterAllMock(),
  },
}));

import { registerGlobalShortcuts, unregisterAllShortcuts } from './shortcuts';

beforeEach(() => {
  registerMock.mockReset().mockReturnValue(true);
  unregisterAllMock.mockReset();
});

describe('registerGlobalShortcuts', () => {
  it('registers exactly the Phase 5 binding set (H / S / Q / C)', () => {
    const toggleOverlay = vi.fn();
    const startStopSession = vi.fn();
    const quit = vi.fn();
    const captureScreenshot = vi.fn();
    registerGlobalShortcuts({ toggleOverlay, startStopSession, quit, captureScreenshot });

    expect(registerMock).toHaveBeenCalledTimes(4);
    const accels = registerMock.mock.calls.map((c) => c[0]);
    expect(accels).toEqual([
      'CommandOrControl+Shift+H',
      'CommandOrControl+Shift+S',
      'CommandOrControl+Shift+Q',
      'CommandOrControl+Shift+C',
    ]);
  });

  it('wires each accelerator to the matching binding', () => {
    const toggleOverlay = vi.fn();
    const startStopSession = vi.fn();
    const quit = vi.fn();
    const captureScreenshot = vi.fn();
    registerGlobalShortcuts({ toggleOverlay, startStopSession, quit, captureScreenshot });

    const byAccel = Object.fromEntries(
      registerMock.mock.calls.map(([accel, fn]) => [accel, fn as () => void]),
    );
    byAccel['CommandOrControl+Shift+H']!();
    byAccel['CommandOrControl+Shift+S']!();
    byAccel['CommandOrControl+Shift+Q']!();
    byAccel['CommandOrControl+Shift+C']!();
    expect(toggleOverlay).toHaveBeenCalledOnce();
    expect(startStopSession).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(captureScreenshot).toHaveBeenCalledOnce();
  });

  it('tolerates a failed registration (another app owns the shortcut)', () => {
    registerMock.mockReturnValue(false);
    expect(() =>
      registerGlobalShortcuts({
        toggleOverlay: vi.fn(),
        startStopSession: vi.fn(),
        quit: vi.fn(),
        captureScreenshot: vi.fn(),
      }),
    ).not.toThrow();
  });
});

describe('unregisterAllShortcuts', () => {
  it('delegates to globalShortcut.unregisterAll', () => {
    unregisterAllShortcuts();
    expect(unregisterAllMock).toHaveBeenCalledOnce();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
