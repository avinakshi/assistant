/**
 * Auto-updater wiring using electron-updater.
 *
 * Behavior in a packaged (installed) build:
 *   - Check for updates on app start, after a short grace period so we don't compete
 *     with window creation for CPU.
 *   - Re-check every 4 hours while the app is running.
 *   - Manual "Check for updates…" from the tray menu.
 *   - When an update is ready, show a renderer notification through the overlay; the user
 *     clicks "Install now" which triggers quitAndInstall().
 *
 * Behavior in dev (unpackaged):
 *   - `autoUpdater.isUpdaterActive()` returns false; all entry points no-op. We never try
 *     to check-for-updates against GitHub from a dev tree, which would be noise.
 */
import type { AppUpdater } from 'electron-updater';
import type { BrowserWindow } from 'electron';
import { logger } from './logger';
import { IpcPushChannels, type UpdaterStatePayload } from '../shared/ipc-contract';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1_000;
const BOOTSTRAP_DELAY_MS = 15 * 1_000;

type Broadcast = (
  channel: (typeof IpcPushChannels)[keyof typeof IpcPushChannels],
  payload: unknown,
) => void;

export interface UpdaterDeps {
  broadcast: Broadcast;
  getOverlay: () => BrowserWindow | null;
}

let activeUpdater: AppUpdater | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let bootstrapTimer: NodeJS.Timeout | null = null;

async function loadUpdater(): Promise<AppUpdater | null> {
  try {
    const mod = await import('electron-updater');
    return mod.autoUpdater;
  } catch (err) {
    logger.warn({ err: String(err) }, 'electron-updater unavailable (dev build?)');
    return null;
  }
}

export async function initUpdater(deps: UpdaterDeps): Promise<void> {
  const updater = await loadUpdater();
  if (!updater) return;
  activeUpdater = updater;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  // Hook our logger so electron-updater's breadcrumbs land in the same pino stream.
  // `any` is unavoidable — electron-updater's Logger interface is loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (updater as any).logger = {
    info: (m: unknown) => logger.info({ mod: 'updater' }, String(m)),
    warn: (m: unknown) => logger.warn({ mod: 'updater' }, String(m)),
    error: (m: unknown) => logger.error({ mod: 'updater' }, String(m)),
    debug: (m: unknown) => logger.debug({ mod: 'updater' }, String(m)),
  };

  const notify = (state: UpdaterStatePayload) => deps.broadcast(IpcPushChannels.UpdaterState, state);

  updater.on('checking-for-update', () => notify({ kind: 'checking' }));
  updater.on('update-available', (info) =>
    notify({ kind: 'available', version: info.version }),
  );
  updater.on('update-not-available', () => notify({ kind: 'up-to-date' }));
  updater.on('download-progress', (p) =>
    notify({ kind: 'downloading', percent: Math.round(p.percent) }),
  );
  updater.on('update-downloaded', (info) =>
    notify({ kind: 'downloaded', version: info.version }),
  );
  updater.on('error', (err) =>
    notify({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
  );

  if (!updater.isUpdaterActive()) {
    logger.info({}, 'updater inactive (dev or unpackaged build) — skipping checks');
    return;
  }

  // Stagger the first check so we don't race the overlay's first paint.
  bootstrapTimer = setTimeout(() => {
    void runCheck('bootstrap');
  }, BOOTSTRAP_DELAY_MS);

  pollTimer = setInterval(() => {
    void runCheck('poll');
  }, FOUR_HOURS_MS);
}

export async function checkForUpdatesNow(): Promise<void> {
  await runCheck('manual');
}

async function runCheck(trigger: 'bootstrap' | 'poll' | 'manual'): Promise<void> {
  if (!activeUpdater) return;
  try {
    logger.info({ trigger }, 'checking for updates');
    await activeUpdater.checkForUpdates();
  } catch (err) {
    logger.warn({ err: String(err), trigger }, 'update check failed');
  }
}

export async function installAndRelaunch(): Promise<void> {
  if (!activeUpdater) return;
  try {
    activeUpdater.quitAndInstall();
  } catch (err) {
    logger.warn({ err: String(err) }, 'quitAndInstall failed');
  }
}

export function shutdownUpdater(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (bootstrapTimer) {
    clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
  }
  activeUpdater = null;
}
