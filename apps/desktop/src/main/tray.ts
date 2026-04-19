import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { logger } from './logger';
import { openSettingsWindow } from './windows/settings';

let tray: Tray | null = null;
let activeDeps: TrayDeps | null = null;
let authState: TrayAuthState = { signedIn: false };
let listeningState = false;

export interface TrayDeps {
  onShowOverlay: () => void;
  onHideOverlay: () => void;
  onQuit: () => void;
  /** Phase 6e. Kick off a browser-based sign-in flow. */
  onSignIn: () => void;
  /** Phase 6e. Clear the stored session. */
  onSignOut: () => void;
  /** Phase 7b. Manual update check. */
  onCheckForUpdates: () => void;
  /** Toggle the live listening state (start/stop Deepgram + LLM). */
  onToggleListening: () => void;
}

export interface TrayAuthState {
  signedIn: boolean;
  email?: string;
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
  tray.setToolTip('Interview Copilot — click to show overlay, right-click for menu');
  // Left-click (or single-click on macOS) = show the overlay. With skipTaskbar=true the
  // window has no taskbar entry, so without this the only recovery path is right-clicking
  // for the context menu — a user who didn't read the docs would permanently lose the
  // overlay on hide. Single-click to restore is the expected Windows tray UX.
  tray.on('click', () => deps.onShowOverlay());
  tray.on('double-click', () => deps.onShowOverlay());
  activeDeps = deps;
  rebuildMenu();
  logger.info({}, 'tray ready');
  return tray;
}

/**
 * Call whenever the auth state changes so the tray menu shows the right "Sign in" /
 * "Signed in as … / Sign out" items.
 */
export function updateTrayAuth(state: TrayAuthState): void {
  authState = state;
  rebuildMenu();
}

/** Call whenever listening is toggled so the tray label flips and the tooltip updates. */
export function updateTrayListening(active: boolean): void {
  listeningState = active;
  if (tray) tray.setToolTip(`Interview Copilot — ${active ? 'listening' : 'idle'}`);
  rebuildMenu();
}

function rebuildMenu(): void {
  if (!tray || !activeDeps) return;
  const deps = activeDeps;
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: listeningState ? 'Stop Listening (Ctrl+Shift+S)' : 'Start Listening (Ctrl+Shift+S)',
      click: deps.onToggleListening,
    },
    { type: 'separator' },
    { label: 'Show Overlay', click: deps.onShowOverlay },
    { label: 'Hide Overlay', click: deps.onHideOverlay },
    { type: 'separator' },
  ];
  if (authState.signedIn) {
    items.push(
      { label: `Signed in${authState.email ? ` as ${authState.email}` : ''}`, enabled: false },
      { label: 'Sign Out', click: deps.onSignOut },
    );
  } else {
    items.push({ label: 'Sign In…', click: deps.onSignIn });
  }
  items.push(
    { type: 'separator' },
    { label: 'Open Settings…', click: () => openSettingsWindow() },
    { label: 'Check for Updates…', click: deps.onCheckForUpdates },
    { type: 'separator' },
    { label: 'Quit Interview Copilot', click: deps.onQuit },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
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
