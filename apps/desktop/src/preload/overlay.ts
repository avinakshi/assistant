/**
 * Overlay preload script.
 *
 * Runs in a sandboxed Electron preload context. Bridges IPC to the renderer via
 * `contextBridge.exposeInMainWorld('ic', { ... })`. No direct Node APIs escape — every method
 * below is a narrow, typed wrapper around `ipcRenderer.invoke` or `ipcRenderer.on`.
 *
 * Bundled by esbuild (see build-preload.mjs) so all cross-package imports are inlined —
 * Electron's sandboxed `preloadRequire` can't resolve relative imports at runtime.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcInvokeChannels,
  IpcPushChannels,
  type AnswerCanceledPayload,
  type AnswerDeltaPayload,
  type AnswerDonePayload,
  type AnswerStartPayload,
  type EchoStatsPayload,
  type OverlayVisibilityPayload,
  type SessionEventPayload,
  type TranscriptFinalPayload,
  type TranscriptPartialPayload,
  type UpdaterStatePayload,
} from '../shared/ipc-contract';

function subscribe<T>(channel: string, fn: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ic', {
  quit: () => ipcRenderer.invoke(IpcInvokeChannels.SystemQuit),
  showOverlay: () => ipcRenderer.invoke(IpcInvokeChannels.SystemShowOverlay),
  hideOverlay: () => ipcRenderer.invoke(IpcInvokeChannels.SystemHideOverlay),
  minimizeOverlay: () => ipcRenderer.invoke(IpcInvokeChannels.SystemMinimizeOverlay),
  expandOverlay: () => ipcRenderer.invoke(IpcInvokeChannels.SystemExpandOverlay),
  toggleListening: () => ipcRenderer.invoke(IpcInvokeChannels.SystemToggleListening),
  openSettings: () => ipcRenderer.invoke(IpcInvokeChannels.SystemOpenSettings),
  captureScreenshot: () => ipcRenderer.invoke(IpcInvokeChannels.SystemCaptureScreenshot),
  updaterCheck: () => ipcRenderer.invoke(IpcInvokeChannels.UpdaterCheck),
  updaterInstall: () => ipcRenderer.invoke(IpcInvokeChannels.UpdaterInstall),

  onEchoStats: (fn: (p: EchoStatsPayload) => void) =>
    subscribe<EchoStatsPayload>(IpcPushChannels.EchoStats, fn),
  onUpdaterState: (fn: (p: UpdaterStatePayload) => void) =>
    subscribe<UpdaterStatePayload>(IpcPushChannels.UpdaterState, fn),
  onOverlayVisibility: (fn: (p: OverlayVisibilityPayload) => void) =>
    subscribe<OverlayVisibilityPayload>(IpcPushChannels.OverlayVisibility, fn),
  onTranscriptPartial: (fn: (p: TranscriptPartialPayload) => void) =>
    subscribe<TranscriptPartialPayload>(IpcPushChannels.TranscriptPartial, fn),
  onTranscriptFinal: (fn: (p: TranscriptFinalPayload) => void) =>
    subscribe<TranscriptFinalPayload>(IpcPushChannels.TranscriptFinal, fn),
  onSessionEvent: (fn: (p: SessionEventPayload) => void) =>
    subscribe<SessionEventPayload>(IpcPushChannels.SessionEvent, fn),

  onAnswerStart: (fn: (p: AnswerStartPayload) => void) =>
    subscribe<AnswerStartPayload>(IpcPushChannels.AnswerStart, fn),
  onAnswerDelta: (fn: (p: AnswerDeltaPayload) => void) =>
    subscribe<AnswerDeltaPayload>(IpcPushChannels.AnswerDelta, fn),
  onAnswerDone: (fn: (p: AnswerDonePayload) => void) =>
    subscribe<AnswerDonePayload>(IpcPushChannels.AnswerDone, fn),
  onAnswerCanceled: (fn: (p: AnswerCanceledPayload) => void) =>
    subscribe<AnswerCanceledPayload>(IpcPushChannels.AnswerCanceled, fn),
});
