import { describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above static imports, so we can import the SUT normally below.
vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
  },
  BrowserWindow: class {},
  app: { getAppPath: () => '/app' },
}));

import { overlayWindowOptions } from './overlay';

describe('overlayWindowOptions — stealth invariants', () => {
  const opts = overlayWindowOptions();

  it('is frameless + transparent + always-on-top + skip-taskbar', () => {
    expect(opts.frame).toBe(false);
    expect(opts.transparent).toBe(true);
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.skipTaskbar).toBe(true);
    expect(opts.hasShadow).toBe(false);
    expect(opts.fullscreenable).toBe(false);
  });

  it('starts hidden so we can call setContentProtection before show()', () => {
    expect(opts.show).toBe(false);
  });

  it('keeps rendering when unfocused (behind Zoom)', () => {
    expect(opts.webPreferences?.backgroundThrottling).toBe(false);
  });

  it('is fully hardened: contextIsolation + sandbox + no Node + webSecurity', () => {
    const w = opts.webPreferences!;
    expect(w.contextIsolation).toBe(true);
    expect(w.nodeIntegration).toBe(false);
    expect(w.sandbox).toBe(true);
    expect(w.webSecurity).toBe(true);
  });

  it('positions in the top-right corner of the primary display', () => {
    // 1920 - 420 width - 20 padding = 1480
    expect(opts.x).toBe(1480);
    expect(opts.y).toBe(40);
  });

  it('uses a preload script (not raw-renderer Node access)', () => {
    expect(opts.webPreferences?.preload).toBeTruthy();
    expect(opts.webPreferences?.preload).toMatch(/overlay/);
  });
});
