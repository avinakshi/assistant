import type { BrowserWindow } from 'electron';
import { logger } from './logger';

/**
 * Apply OS-level window stealth on top of Electron's `setContentProtection`.
 *
 * Windows: extracts the HWND pointer from `getNativeWindowHandle()` and calls the native
 * `applyStealth(hwnd, 'win')` which invokes `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`.
 *
 * macOS: no-op from here — Electron's `setContentProtection(true)` already sets
 * `NSWindow.sharingType = NSWindowSharingNone`, and LSUIElement (Info.plist) kills the dock
 * entry. The Rust side has a no-op stub so the contract is symmetric.
 *
 * If the native addon isn't loadable (dev machine without rustup, wrong arch), we log a
 * WARN and continue — the window still has `setContentProtection(true)`. This is degraded
 * but not catastrophic for Mac. On Windows without the addon, there is NO stealth at all —
 * see KNOWN_LIMITATIONS.md.
 */
export function applyStealthForThisWindow(win: BrowserWindow): void {
  if (process.platform === 'darwin') {
    logger.debug({}, 'mac stealth: setContentProtection only');
    return;
  }
  if (process.platform !== 'win32') {
    logger.warn({ platform: process.platform }, 'stealth: unsupported platform, visible overlay');
    return;
  }

  let addon: typeof import('@repo/audio-core') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    addon = require('@repo/audio-core') as typeof import('@repo/audio-core');
  } catch (err) {
    logger.error(
      { err: String(err) },
      'CRITICAL: audio-core native addon failed to load — overlay is NOT stealthy',
    );
    return;
  }

  const handleBuffer = win.getNativeWindowHandle();
  if (handleBuffer.byteLength === 0) {
    logger.warn({}, 'getNativeWindowHandle returned empty buffer; skipping stealth');
    return;
  }
  // On 64-bit Windows, HWND is an 8-byte pointer. On 32-bit (not a supported target), 4 bytes.
  const hwnd =
    handleBuffer.byteLength >= 8
      ? handleBuffer.readBigUInt64LE(0)
      : BigInt(handleBuffer.readUInt32LE(0));
  if (hwnd === 0n) {
    logger.warn({}, 'HWND is zero; skipping stealth');
    return;
  }

  try {
    addon.applyStealth(hwnd, 'win');
    logger.info({ hwnd: hwnd.toString() }, 'WDA_EXCLUDEFROMCAPTURE applied');
  } catch (err) {
    logger.error({ err: String(err) }, 'applyStealth threw — overlay is NOT stealthy');
  }
}
