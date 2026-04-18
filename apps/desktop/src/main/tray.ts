import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { logger } from './logger';
import { openSettingsWindow } from './windows/settings';

let tray: Tray | null = null;

export interface TrayDeps {
  onShowOverlay: () => void;
  onHideOverlay: () => void;
  onQuit: () => void;
}

export function setupTray(deps: TrayDeps): Tray {
  if (tray) return tray;

  // Phase 2: solid 16×16 placeholder icon. Phase 7 ships a proper branded set
  // (templated for macOS dark/light, high-DPI Windows variants).
  const iconPath = path.join(app.getAppPath(), 'resources', 'tray-icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = buildFallbackIcon();
  }
  if (process.platform === 'darwin') image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip('Interview Copilot');
  const menu = Menu.buildFromTemplate([
    { label: 'Show Overlay', click: deps.onShowOverlay },
    { label: 'Hide Overlay', click: deps.onHideOverlay },
    { type: 'separator' },
    { label: 'Open Settings…', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit Interview Copilot', click: deps.onQuit },
  ]);
  tray.setContextMenu(menu);
  logger.info({}, 'tray ready');
  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

/**
 * Minimal 16×16 RGBA image built in-memory so dev/test runs don't require a PNG asset.
 * Phase 7 replaces this with proper branding.
 */
function buildFallbackIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      buf[i] = edge ? 255 : 94;
      buf[i + 1] = edge ? 255 : 162;
      buf[i + 2] = edge ? 255 : 255;
      buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}
