import { BrowserWindow, screen } from 'electron';
import { preloadPath, rendererUrl } from './paths';
import { logger } from '../logger';
import { applyStealthForThisWindow } from '../stealth';

export const OVERLAY_DEFAULT_WIDTH = 420;
// Phase 4: bumped to accommodate the answer scroll area. Width stays constant so Phase 2
// stealth matrix rows still apply without re-testing resizing cases.
export const OVERLAY_DEFAULT_HEIGHT = 520;

/**
 * Returns the strict set of BrowserWindow options we ship for the overlay.
 *
 * Isolated as a pure function so we can snapshot-test every stealth-relevant flag without
 * spinning up Electron. The spec is non-negotiable — regressions here break stealth.
 */
export function overlayWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: OVERLAY_DEFAULT_WIDTH,
    height: OVERLAY_DEFAULT_HEIGHT,
    x: Math.max(20, width - OVERLAY_DEFAULT_WIDTH - 20),
    y: 40,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    show: false, // we call show() after stealth is applied
    webPreferences: {
      preload: preloadPath('overlay'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // must keep rendering when unfocused (behind Zoom)
      webSecurity: true,
      spellcheck: false,
      disableDialogs: true,
    },
  };
}

export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow(overlayWindowOptions());
  void win.loadURL(rendererUrl('overlay'));

  win.once('ready-to-show', () => {
    // Order matters: setContentProtection must happen AFTER show() on some macOS versions.
    // We use .showInactive() so the meeting app keeps focus (important during screen share).
    win.showInactive();
    win.setContentProtection(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    applyStealthForThisWindow(win);
    logger.info(
      {
        width: OVERLAY_DEFAULT_WIDTH,
        height: OVERLAY_DEFAULT_HEIGHT,
        platform: process.platform,
      },
      'overlay window ready + stealth applied',
    );
  });

  win.on('closed', () => {
    logger.info({}, 'overlay window closed');
  });

  return win;
}
