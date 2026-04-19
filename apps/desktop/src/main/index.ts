/**
 * Electron main process entry.
 *
 * Phase 3 surface:
 *   - overlay (stealth) + settings windows
 *   - tray icon with menu
 *   - global shortcuts (Ctrl+Shift+H / S / Q)
 *   - audio pipeline: AudioSource → WS → api `/ws/session` (when WS_SHARED_SECRET set) or
 *     `/ws/echo` (diagnostic fallback).
 *   - transcript pipeline: api → main → IPC broadcast to overlay renderer
 *
 * Run modes:
 *   - Under Electron (production/start): `electron dist/main/index.js`
 *   - Under tsx for pipeline-only dev: `tsx watch src/main/index.ts`
 */
import { AudioPipeline } from './audio/pipeline';
import { createAudioSource, type AudioSourceKind } from './audio/audio-source';
import { WsClient, type WsRoute } from './ws/ws-client';
import { logger } from './logger';
import { config } from './config';
import {
  IpcPushChannels,
  type AnswerCanceledPayload,
  type AnswerDeltaPayload,
  type AnswerDonePayload,
  type AnswerStartPayload,
  type SessionEventPayload,
  type TranscriptFinalPayload,
  type TranscriptPartialPayload,
} from '../shared/ipc-contract';

function resolveAudioSource(): AudioSourceKind {
  const raw = process.env.AUDIO_SOURCE;
  return raw === 'native' ? 'native' : 'stub';
}

function resolveWsRoute(): WsRoute {
  // Prefer /ws/session when we have a token — it's the real product flow.
  const raw = process.env.WS_ROUTE;
  if (raw === 'echo' || raw === 'session') return raw;
  return process.env.WS_SHARED_SECRET ? 'session' : 'echo';
}

const AUDIO_SOURCE: AudioSourceKind = resolveAudioSource();
const WS_ROUTE: WsRoute = resolveWsRoute();
const SESSION_LANGUAGE = process.env.SESSION_LANGUAGE ?? 'en';

interface PipelineRefs {
  pipeline: AudioPipeline;
  ws: WsClient;
  shutdown: () => Promise<void>;
}

async function bootstrapPipeline(
  broadcast?: (channel: (typeof IpcPushChannels)[keyof typeof IpcPushChannels], payload: unknown) => void,
): Promise<PipelineRefs> {
  logger.info(
    { audioSource: AUDIO_SOURCE, route: WS_ROUTE, apiUrl: config.DESKTOP_API_WS_URL, language: SESSION_LANGUAGE },
    'desktop main starting pipeline',
  );
  const source = createAudioSource(AUDIO_SOURCE);
  const sessionToken = WS_ROUTE === 'session' ? process.env.WS_SHARED_SECRET : undefined;
  const ws = new WsClient({
    url: config.DESKTOP_API_WS_URL,
    route: WS_ROUTE,
    ...(sessionToken ? { token: sessionToken } : {}),
    onReady: () => {
      logger.info({}, 'session ready');
      broadcast?.(IpcPushChannels.SessionEvent, { kind: 'ready' } satisfies SessionEventPayload);
    },
    onTerminalError: (msg) => {
      const kind: SessionEventPayload['kind'] =
        msg.code === 'AUTH' ? 'auth-failed' : 'quota-exceeded';
      broadcast?.(IpcPushChannels.SessionEvent, { kind, message: msg.message });
    },
    onMessage: (msg) => {
      if (!broadcast) return;
      if (msg.type === 'transcript.partial') {
        // Log only the character count — never the transcript text itself (interviewer
        // speech is PII under two-party consent).
        logger.debug({ chars: msg.text.length, ts: msg.ts }, 'transcript.partial → renderer');
        broadcast(IpcPushChannels.TranscriptPartial, {
          text: msg.text,
          ts: msg.ts,
        } satisfies TranscriptPartialPayload);
      } else if (msg.type === 'transcript.final') {
        logger.info(
          { chars: msg.text.length, isQuestion: msg.isQuestion, ts: msg.ts },
          'transcript.final → renderer',
        );
        broadcast(IpcPushChannels.TranscriptFinal, {
          text: msg.text,
          ts: msg.ts,
          isQuestion: msg.isQuestion,
        } satisfies TranscriptFinalPayload);
      } else if (msg.type === 'answer.start') {
        logger.info(
          { answerId: msg.answerId, provider: msg.provider, mode: msg.mode },
          'answer.start → renderer',
        );
        broadcast(IpcPushChannels.AnswerStart, {
          answerId: msg.answerId,
          provider: msg.provider,
          ...(msg.mode ? { mode: msg.mode } : {}),
        } satisfies AnswerStartPayload);
      } else if (msg.type === 'answer.delta') {
        // No PII logging of delta text; the full answer stream is considered interview PII.
        broadcast(IpcPushChannels.AnswerDelta, {
          answerId: msg.answerId,
          text: msg.text,
        } satisfies AnswerDeltaPayload);
      } else if (msg.type === 'answer.done') {
        logger.info(
          { answerId: msg.answerId, latencyMs: msg.latencyMs, totalTokens: msg.totalTokens },
          'answer.done → renderer',
        );
        broadcast(IpcPushChannels.AnswerDone, {
          answerId: msg.answerId,
          totalTokens: msg.totalTokens,
          latencyMs: msg.latencyMs,
        } satisfies AnswerDonePayload);
      } else if (msg.type === 'answer.canceled') {
        logger.info(
          { answerId: msg.answerId, reason: msg.reason },
          'answer.canceled → renderer',
        );
        broadcast(IpcPushChannels.AnswerCanceled, {
          answerId: msg.answerId,
          reason: msg.reason,
        } satisfies AnswerCanceledPayload);
      }
    },
  });
  const pipeline = new AudioPipeline(source, ws);
  await pipeline.start();

  // Do NOT auto-start the session. In Phase 4 the pipeline opened STT + the LLM on boot,
  // which meant any system audio (music, meetings, cricket commentary on another tab) ran
  // through Deepgram and could trigger Gemini calls. Live testing confirmed this burned
  // quota on background chatter. Users now press Ctrl+Shift+S (or the tray item) to start
  // listening. Frames still flow to the api in the meantime but are dropped server-side
  // until `session.start` arrives.

  return {
    pipeline,
    ws,
    shutdown: async () => {
      if (WS_ROUTE === 'session') ws.stopSession();
      await pipeline.stop();
    },
  };
}

async function bootstrapWithWindows(): Promise<void> {
  const electron = await import('electron');
  const { app, BrowserWindow, shell } = electron;

  app.setName('Interview Copilot');

  // Phase 6e: we need a single-instance lock so that on Windows, when the user clicks an
  // ic://auth-callback link in their browser, the OS relaunches us with argv containing
  // the URL — the first (existing) instance catches it via `second-instance`. Without the
  // lock, we'd spin up a second copy and the deep link would never reach the live app.
  if (!app.requestSingleInstanceLock()) {
    logger.info({}, 'another instance holds the lock; exiting');
    app.quit();
    return;
  }

  // Register ic:// as our custom protocol handler. Best effort — fails benignly if the
  // user has already pointed ic:// at something else (rare, but don't crash).
  try {
    app.setAsDefaultProtocolClient('ic');
  } catch (err) {
    logger.warn({ err: String(err) }, 'setAsDefaultProtocolClient failed');
  }

  await app.whenReady();

  // Start crash logging as soon as we have `app` access. Must come before any other code
  // that might throw so we capture the failure.
  const { initCrashReporter } = await import('./crash-reporter');
  initCrashReporter();

  const { createOverlayWindow } = await import('./windows/overlay');
  const { registerIpcHandlers, broadcastToRenderers, captureAndShip } = await import(
    './ipc/index'
  );
  const { setupTray, destroyTray, updateTrayAuth, updateTrayListening } = await import(
    './tray'
  );
  const { registerGlobalShortcuts, unregisterAllShortcuts } = await import('./shortcuts');
  const { AuthStore } = await import('./auth/auth-store');
  const {
    beginLogin,
    parseCallbackUrl,
    completeLogin,
    CallbackParseError,
    CallbackAuthError,
  } = await import('./auth/login-flow');
  const { initUpdater, checkForUpdatesNow, installAndRelaunch, shutdownUpdater } = await import(
    './updater'
  );

  const authStore = new AuthStore({ userDataDir: app.getPath('userData') });
  await authStore.load();

  const overlay = createOverlayWindow();

  // WsClient reference — set once the pipeline bootstraps below. IPC + hotkey handlers
  // read this lazily so they don't crash if they fire before the pipeline is ready.
  let activeWs: import('./ws/ws-client').WsClient | null = null;

  registerIpcHandlers({
    getOverlay: () => (overlay.isDestroyed() ? null : overlay),
    getWs: () => activeWs,
    onCheckForUpdates: () => checkForUpdatesNow(),
    onInstallUpdate: () => installAndRelaunch(),
  });

  // Dev/CI callers pass WS_SHARED_SECRET so the WS works without a signed-in user.
  // Preserve it as the fallback token: on sign-out (or before first sign-in) we re-apply
  // it rather than wiping the token to undefined, which would 1008-auth every reconnect.
  const fallbackToken =
    WS_ROUTE === 'session' ? process.env.WS_SHARED_SECRET ?? undefined : undefined;

  const applySessionToWs = (): void => {
    const sess = authStore.getSession();
    if (activeWs) activeWs.setToken(sess?.accessToken ?? fallbackToken);
    updateTrayAuth(
      sess ? { signedIn: true, ...(sess.email ? { email: sess.email } : {}) } : { signedIn: false },
    );
  };

  // Listening state. False by default — the session is NOT live until the user explicitly
  // starts it (Ctrl+Shift+S or tray). This prevents background audio from burning LLM
  // quota; see commit history for the live-test incident that drove this.
  let isListening = false;

  const setListening = (next: boolean): void => {
    if (next === isListening) return;
    if (WS_ROUTE !== 'session') {
      // Echo route ignores session toggles — keep the flag in sync but don't touch the WS.
      isListening = next;
      return;
    }
    if (!activeWs) {
      logger.warn({}, 'toggleListening fired before WS ready — ignoring');
      return;
    }
    if (next) {
      activeWs.startSession({
        language: SESSION_LANGUAGE,
        mode: 'auto',
        llm: 'auto',
        // Phase 9: persist turns + LLM answers for post-session review. Users can delete
        // any session from /app/sessions afterward. A future Settings toggle can flip the
        // default; hardcoded true for now since most users running live mode want review.
        persistTranscripts: true,
      });
      logger.info({}, 'listening started');
      broadcastToRenderers(IpcPushChannels.SessionEvent, {
        kind: 'listening',
      } satisfies SessionEventPayload);
    } else {
      activeWs.stopSession();
      logger.info({}, 'listening stopped');
      broadcastToRenderers(IpcPushChannels.SessionEvent, {
        kind: 'idle',
      } satisfies SessionEventPayload);
    }
    isListening = next;
    updateTrayListening(next);
  };

  const toggleListening = (): void => setListening(!isListening);

  const handleDeepLink = async (rawUrl: string): Promise<void> => {
    if (!rawUrl.startsWith('ic://')) return;
    logger.info({}, 'received ic:// deep link');
    try {
      const parsed = parseCallbackUrl(rawUrl);
      const session = await completeLogin({ authStore, callback: parsed });
      logger.info({ userId: session.userId, hasEmail: !!session.email }, 'sign-in complete');
      applySessionToWs();
    } catch (err) {
      const reason =
        err instanceof CallbackParseError || err instanceof CallbackAuthError ? err.reason : 'unknown';
      logger.warn({ reason, err: String(err) }, 'deep-link handling failed');
    }
  };

  // macOS sends deep links via `open-url`. Windows/Linux send them via argv on a second
  // instance — we relay that through the `second-instance` listener below.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleDeepLink(url);
  });

  app.on('second-instance', (_event, argv) => {
    // argv on Windows looks like [exePath, 'ic://auth-callback?...']. Last arg is usually
    // the URL, but search defensively in case Electron prepends flags.
    const url = argv.find((a) => a.startsWith('ic://'));
    if (url) void handleDeepLink(url);
    // Also bring the overlay forward so the user has visible feedback.
    if (!overlay.isDestroyed()) {
      overlay.showInactive();
      broadcastToRenderers(IpcPushChannels.OverlayVisibility, { visible: true });
    }
  });

  setupTray({
    onShowOverlay: () => {
      if (!overlay.isDestroyed()) {
        overlay.showInactive();
        broadcastToRenderers(IpcPushChannels.OverlayVisibility, { visible: true });
      }
    },
    onHideOverlay: () => {
      if (!overlay.isDestroyed()) {
        overlay.hide();
        broadcastToRenderers(IpcPushChannels.OverlayVisibility, { visible: false });
      }
    },
    onSignIn: () => {
      void (async () => {
        const { browserUrl } = await beginLogin({
          authStore,
          webBaseUrl: config.DESKTOP_WEB_BASE_URL,
        });
        logger.info({}, 'opening browser for sign-in');
        await shell.openExternal(browserUrl);
      })();
    },
    onSignOut: () => {
      void (async () => {
        await authStore.clearSession();
        applySessionToWs();
        logger.info({}, 'signed out');
      })();
    },
    onCheckForUpdates: () => {
      void checkForUpdatesNow();
    },
    onToggleListening: () => toggleListening(),
    onQuit: () => {
      logger.info({ reason: 'tray' }, 'quit requested');
      app.quit();
    },
  });

  // Kick off the auto-updater. No-op in dev/unpackaged builds.
  await initUpdater({
    broadcast: broadcastToRenderers,
    getOverlay: () => (overlay.isDestroyed() ? null : overlay),
  });

  // Reflect any persisted sign-in state in the tray immediately.
  updateTrayAuth(
    (() => {
      const s = authStore.getSession();
      return s ? { signedIn: true, ...(s.email ? { email: s.email } : {}) } : { signedIn: false };
    })(),
  );

  registerGlobalShortcuts({
    toggleOverlay: () => {
      if (overlay.isDestroyed()) return;
      if (overlay.isVisible()) {
        overlay.hide();
        broadcastToRenderers(IpcPushChannels.OverlayVisibility, { visible: false });
      } else {
        overlay.showInactive();
        broadcastToRenderers(IpcPushChannels.OverlayVisibility, { visible: true });
      }
    },
    startStopSession: () => {
      toggleListening();
    },
    quit: () => {
      logger.info({ reason: 'shortcut' }, 'quit requested');
      app.quit();
    },
    captureScreenshot: () => {
      void captureAndShip({ getWs: () => activeWs });
    },
  });

  const {
    pipeline,
    ws: pipelineWs,
    shutdown: shutdownPipeline,
  } = await bootstrapPipeline(broadcastToRenderers);
  activeWs = pipelineWs;
  pipeline.onStats((payload) => {
    broadcastToRenderers(IpcPushChannels.EchoStats, payload);
  });
  // If we already had a saved session on disk, push its access token into the WS now.
  applySessionToWs();
  // Announce the initial idle state so the overlay renders the "Press Ctrl+Shift+S to
  // start listening" hint instead of flashing an empty transcript pane.
  broadcastToRenderers(IpcPushChannels.SessionEvent, {
    kind: 'idle',
  } satisfies SessionEventPayload);
  updateTrayListening(false);

  app.on('window-all-closed', () => {
    // Tray-resident: do NOT quit. User explicitly quits via tray menu or Ctrl+Shift+Q.
  });

  app.on('before-quit', async () => {
    logger.info({}, 'before-quit: tearing down');
    unregisterAllShortcuts();
    destroyTray();
    shutdownUpdater();
    try {
      await shutdownPipeline();
    } catch (err) {
      logger.error({ err: String(err) }, 'pipeline shutdown failed');
    }
  });

  logger.info({ windowCount: BrowserWindow.getAllWindows().length }, 'desktop ready');
}

async function bootstrapHeadless(): Promise<void> {
  const { shutdown } = await bootstrapPipeline();
  const stop = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'desktop main shutting down (headless)');
    await shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

if (typeof process !== 'undefined' && process.versions?.electron === undefined) {
  void bootstrapHeadless();
} else {
  void bootstrapWithWindows().catch((err: unknown) => {
    logger.error({ err: String(err) }, 'fatal bootstrap error');
    process.exit(1);
  });
}
