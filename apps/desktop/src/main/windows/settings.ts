import { BrowserWindow } from 'electron';
import { preloadPath, rendererUrl } from './paths';
import { logger } from '../logger';

let settingsWindow: BrowserWindow | null = null;

export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }
  const win = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 600,
    minHeight: 420,
    show: false,
    title: 'Interview Copilot — Settings',
    backgroundColor: '#0f1218',
    webPreferences: {
      preload: preloadPath('settings'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  void win.loadURL(rendererUrl('settings'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    settingsWindow = null;
    logger.info({}, 'settings window closed');
  });
  settingsWindow = win;
  return win;
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}
