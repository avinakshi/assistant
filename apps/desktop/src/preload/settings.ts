/**
 * Settings window preload.
 *
 * Phase 2 exposes only the common system actions — real settings CRUD lands in Phase 6.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IpcInvokeChannels } from '../shared/ipc-contract';

contextBridge.exposeInMainWorld('ic', {
  quit: () => ipcRenderer.invoke(IpcInvokeChannels.SystemQuit),
  showOverlay: () => ipcRenderer.invoke(IpcInvokeChannels.SystemShowOverlay),
  hideOverlay: () => ipcRenderer.invoke(IpcInvokeChannels.SystemHideOverlay),
  openSettings: () => ipcRenderer.invoke(IpcInvokeChannels.SystemOpenSettings),
});
