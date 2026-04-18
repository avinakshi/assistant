import { app, BrowserWindow, ipcMain } from 'electron';
import {
  IpcInvokeChannels,
  IpcPushChannels,
  type CaptureScreenshotResult,
} from '../../shared/ipc-contract';
import { openSettingsWindow } from '../windows/settings';
import { logger } from '../logger';
import type { WsClient } from '../ws/ws-client';

export interface IpcDeps {
  getOverlay: () => BrowserWindow | null;
  /** The live WsClient; screenshots are forwarded over the session stream. */
  getWs: () => WsClient | null;
  /** Phase 7b — renderer can trigger check + install via IPC. Optional for test setups. */
  onCheckForUpdates?: () => void | Promise<void>;
  onInstallUpdate?: () => void | Promise<void>;
}

/**
 * Registers every renderer → main IPC channel. Each handler is a closure over `deps`, so
 * the boundary stays a single object — no module-level globals.
 *
 * Payload validation is minimal: every channel is void so far. When a channel carries
 * data, we'll add a Zod validator here.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle(IpcInvokeChannels.SystemQuit, () => {
    logger.info({ reason: 'ipc' }, 'quit requested');
    app.quit();
  });

  ipcMain.handle(IpcInvokeChannels.SystemShowOverlay, () => {
    const w = deps.getOverlay();
    if (w && !w.isDestroyed()) w.showInactive();
  });

  ipcMain.handle(IpcInvokeChannels.SystemHideOverlay, () => {
    const w = deps.getOverlay();
    if (w && !w.isDestroyed()) w.hide();
  });

  ipcMain.handle(IpcInvokeChannels.SystemOpenSettings, () => {
    openSettingsWindow();
  });

  ipcMain.handle(IpcInvokeChannels.SystemCaptureScreenshot, async (): Promise<CaptureScreenshotResult> => {
    return captureAndShip(deps);
  });

  ipcMain.handle(IpcInvokeChannels.UpdaterCheck, async () => {
    await deps.onCheckForUpdates?.();
  });

  ipcMain.handle(IpcInvokeChannels.UpdaterInstall, async () => {
    await deps.onInstallUpdate?.();
  });
}

/**
 * Invoked either from the IPC channel or directly from the Ctrl+Shift+C hotkey. Runs the
 * native screenshot, hands the PNG to the WS session. Reports ok+byte-count on success.
 *
 * Exported so `shortcuts.ts` can call it without routing through IPC (the hotkey fires in
 * the main process; no renderer round-trip needed).
 */
export async function captureAndShip(
  deps: Pick<IpcDeps, 'getWs'>,
): Promise<CaptureScreenshotResult> {
  const started = Date.now();
  let addon: typeof import('@repo/audio-core');
  try {
    // Dynamic require so the audio-core native addon is optional in dev (renderer-only runs).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    addon = require('@repo/audio-core') as typeof import('@repo/audio-core');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'audio-core failed to load — cannot screenshot');
    return { ok: false, error: `audio-core unavailable: ${msg}` };
  }

  let png: Buffer;
  try {
    png = addon.captureScreenshot();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'captureScreenshot threw');
    return { ok: false, error: msg };
  }

  const ws = deps.getWs();
  if (!ws) {
    logger.warn({}, 'screenshot captured but no active WS session — dropping');
    return { ok: false, error: 'no active session' };
  }

  const result = ws.sendScreenshot(png);
  if (!result.ok) {
    logger.warn({ reason: result.reason }, 'failed to send screenshot over ws');
    return { ok: false, error: result.reason };
  }

  logger.info(
    { bytes: png.byteLength, elapsedMs: Date.now() - started },
    'screenshot captured + shipped',
  );
  return { ok: true, bytes: png.byteLength };
}

/**
 * Push a payload to every live renderer. Used for broadcasts like echo-stats and visibility.
 */
export function broadcastToRenderers(
  channel: (typeof IpcPushChannels)[keyof typeof IpcPushChannels],
  payload: unknown,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
