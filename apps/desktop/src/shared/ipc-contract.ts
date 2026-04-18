/**
 * Single source of truth for the main ↔ renderer IPC surface.
 *
 * Anything added here must be:
 *   1. Registered in apps/desktop/src/main/ipc/index.ts (with a Zod validator).
 *   2. Exposed by apps/desktop/src/preload/overlay.ts (or settings.ts).
 *   3. Consumed from the renderer via `window.ic.<channel>`.
 *
 * Keep this file dependency-free — it's imported by main, preload, and renderer.
 */

// Channels: renderer → main (invoke, request/response).
export const IpcInvokeChannels = {
  /** System actions. */
  SystemQuit: 'system:quit',
  SystemShowOverlay: 'system:show-overlay',
  SystemHideOverlay: 'system:hide-overlay',
  SystemOpenSettings: 'system:open-settings',
  /** Capture the screen, encode PNG, push as `screenshot` ClientMessage over the WS. */
  SystemCaptureScreenshot: 'system:capture-screenshot',
  /** Kick off a manual update check (tray menu / settings). */
  UpdaterCheck: 'updater:check',
  /** User consented to install a downloaded update — relaunches. */
  UpdaterInstall: 'updater:install',
} as const;
export type IpcInvokeChannel = (typeof IpcInvokeChannels)[keyof typeof IpcInvokeChannels];

export interface CaptureScreenshotResult {
  readonly ok: boolean;
  readonly bytes?: number;
  readonly error?: string;
}

// Channels: main → renderer (push, event stream).
export const IpcPushChannels = {
  /** Frame-stat telemetry from the api. Renderer uses this for the live RMS bar. */
  EchoStats: 'push:echo-stats',
  /** Overlay visibility toggle — hotkey fires this, renderer may animate. */
  OverlayVisibility: 'push:overlay-visibility',
  /** Live transcript — interim words arriving from Deepgram (or fallback). */
  TranscriptPartial: 'push:transcript-partial',
  /** Final transcript — endpoint reached, possibly flagged as question. */
  TranscriptFinal: 'push:transcript-final',
  /** Session lifecycle events — ready / quota / error. */
  SessionEvent: 'push:session-event',
  /** Answer stream. Renderer batches delta application via requestAnimationFrame. */
  AnswerStart: 'push:answer-start',
  AnswerDelta: 'push:answer-delta',
  AnswerDone: 'push:answer-done',
  AnswerCanceled: 'push:answer-canceled',
  /** Auto-updater state transitions. Renderer drives the "Update ready" UI from these. */
  UpdaterState: 'push:updater-state',
} as const;
export type IpcPushChannel = (typeof IpcPushChannels)[keyof typeof IpcPushChannels];

export interface EchoStatsPayload {
  readonly framesReceived: number;
  readonly framesPerSecond: number;
  readonly rmsDb: number;
  readonly windowMs: number;
}

export interface OverlayVisibilityPayload {
  readonly visible: boolean;
}

export interface TranscriptPartialPayload {
  readonly text: string;
  readonly ts: number;
}

export interface TranscriptFinalPayload {
  readonly text: string;
  readonly ts: number;
  readonly isQuestion: boolean;
}

export interface SessionEventPayload {
  readonly kind: 'ready' | 'quota-exceeded' | 'stt-error' | 'auth-failed' | 'disconnected';
  readonly message?: string;
}

export interface AnswerStartPayload {
  readonly answerId: string;
  readonly provider: string;
  readonly mode?: string;
}

export interface AnswerDeltaPayload {
  readonly answerId: string;
  readonly text: string;
}

export interface AnswerDonePayload {
  readonly answerId: string;
  readonly totalTokens: number;
  readonly latencyMs: number;
}

export interface AnswerCanceledPayload {
  readonly answerId: string;
  readonly reason: 'newer_question' | 'user_abort' | 'upstream_error';
}

export type UpdaterStatePayload =
  | { readonly kind: 'checking' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'downloading'; readonly percent: number }
  | { readonly kind: 'downloaded'; readonly version: string }
  | { readonly kind: 'error'; readonly message: string };
