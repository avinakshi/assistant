import { globalShortcut } from 'electron';
import { logger } from './logger';

export interface ShortcutBindings {
  toggleOverlay: () => void;
  startStopSession: () => void;
  quit: () => void;
  /** Ctrl+Shift+C — capture a screenshot and ship to the session for OCR + coding mode. */
  captureScreenshot: () => void;
}

/**
 * Phase 2 shortcut set — keyboard-driven because mouse movement during an interview is a
 * cursor-tracking risk (one of our differentiators vs. Parakeet per 01-BUSINESS.md).
 *
 * - Ctrl+Shift+H: hide / show the overlay
 * - Ctrl+Shift+S: start/stop session — placeholder in Phase 2, wired in Phase 3
 * - Ctrl+Shift+Q: quit the app entirely (doesn't wait for tray)
 *
 * Global shortcuts fire even when our app is not focused — critical so the user can toggle
 * visibility during a Zoom call without losing focus on the meeting window.
 */
export function registerGlobalShortcuts(bindings: ShortcutBindings): void {
  const entries: [string, () => void][] = [
    ['CommandOrControl+Shift+H', bindings.toggleOverlay],
    ['CommandOrControl+Shift+S', bindings.startStopSession],
    ['CommandOrControl+Shift+Q', bindings.quit],
    ['CommandOrControl+Shift+C', bindings.captureScreenshot],
  ];
  for (const [accel, fn] of entries) {
    const registered = globalShortcut.register(accel, fn);
    if (!registered) {
      logger.warn({ accel }, 'global shortcut failed to register — likely owned by another app');
    } else {
      logger.debug({ accel }, 'global shortcut registered');
    }
  }
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll();
}
