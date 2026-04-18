/**
 * Local crash logging — writes to `<userData>/crash.log` on any unhandled failure
 * (uncaught exception, unhandled promise rejection, renderer or child-process crash).
 *
 * Optional upload: on next app start, if a crash log exists AND the CRASH_WEBHOOK_URL env
 * var is set, we POST the log as `application/json` and then rotate it to `crash.log.old`.
 *
 * This is deliberately not Sentry: Sentry is the right answer long-term but integrating it
 * needs a DSN + bundling the SDK into the sandboxed preload path. The local-file flow
 * buys us basic operational visibility right now without an external service, and a
 * sentry-electron swap-in later only has to replace the `appendCrash` function.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { logger } from './logger';

interface CrashRecord {
  readonly ts: string;
  readonly kind:
    | 'uncaught-exception'
    | 'unhandled-rejection'
    | 'render-process-gone'
    | 'child-process-gone';
  readonly message: string;
  readonly stack?: string;
  readonly meta?: Record<string, unknown>;
  readonly appVersion: string;
  readonly platform: string;
}

let logPath = '';
let ready = false;

export function initCrashReporter(): void {
  if (ready) return;
  ready = true;
  logPath = path.join(app.getPath('userData'), 'crash.log');

  process.on('uncaughtException', (err) => {
    void appendCrash({
      kind: 'uncaught-exception',
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    });
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    void appendCrash({
      kind: 'unhandled-rejection',
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    });
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    void appendCrash({
      kind: 'render-process-gone',
      message: `renderer gone: reason=${details.reason} exitCode=${details.exitCode}`,
      meta: {
        url: webContents.getURL(),
        reason: details.reason,
        exitCode: details.exitCode,
      },
    });
  });

  app.on('child-process-gone', (_event, details) => {
    void appendCrash({
      kind: 'child-process-gone',
      message: `child ${details.type} gone: reason=${details.reason}`,
      meta: details as unknown as Record<string, unknown>,
    });
  });

  // Rotate + upload any crash from the previous run. Fire-and-forget: never block startup.
  void flushPendingCrashes();
}

async function appendCrash(core: Omit<CrashRecord, 'ts' | 'appVersion' | 'platform'>): Promise<void> {
  const rec: CrashRecord = {
    ts: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
    ...core,
  };
  try {
    const line = JSON.stringify(rec) + '\n';
    await fs.appendFile(logPath, line, { encoding: 'utf8', mode: 0o600 });
    logger.error({ crash: rec }, 'crash logged');
  } catch (err) {
    // Last-resort: if we can't even write to disk, at least log through pino.
    logger.error({ err: String(err), rec }, 'failed to append crash log');
  }
}

async function flushPendingCrashes(): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') logger.warn({ err: String(err) }, 'crash log read failed');
    return;
  }
  if (raw.trim().length === 0) return;

  const webhook = process.env.CRASH_WEBHOOK_URL;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'interview-copilot', entries: raw.trim().split('\n') }),
      });
      logger.info({ status: res.status }, 'crash log uploaded');
    } catch (err) {
      logger.warn({ err: String(err) }, 'crash log upload failed (keeping file)');
      return; // keep file for the next run
    }
  } else {
    logger.info({ path: logPath }, 'crash log present; set CRASH_WEBHOOK_URL to auto-upload');
  }

  // Rotate whether or not we uploaded — a stale crash log should never be re-sent forever.
  try {
    await fs.rename(logPath, `${logPath}.old`);
  } catch (err) {
    logger.warn({ err: String(err) }, 'crash log rotate failed');
  }
}
