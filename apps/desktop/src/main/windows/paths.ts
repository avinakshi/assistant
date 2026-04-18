import path from 'node:path';

/**
 * Resolve a renderer HTML file or a Vite dev URL depending on environment.
 *
 * - In dev (Vite server): VITE_DEV_SERVER_URL=http://localhost:5273 — we load `${base}/<entry>/index.html`.
 * - In compiled runs / production: relative to this file's compiled location.
 *   `__dirname` = `.../dist/main/windows`, renderer lives at `../../renderer/<entry>/index.html`.
 *
 * We deliberately avoid `app.getAppPath()` because its value depends on how Electron was
 * invoked — launching with `electron dist/main/index.js` returns the entry's directory, not
 * the package root.
 */
export function rendererUrl(entry: 'overlay' | 'settings'): string {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    const base = devUrl.replace(/\/+$/, '');
    return `${base}/${entry}/index.html`;
  }
  const html = path.resolve(__dirname, '..', '..', 'renderer', entry, 'index.html');
  return `file://${html.replace(/\\/g, '/')}`;
}

export function preloadPath(entry: 'overlay' | 'settings'): string {
  // `.../dist/main/windows/../../preload/<entry>.js` = `.../dist/preload/<entry>.js`
  return path.resolve(__dirname, '..', '..', 'preload', `${entry}.js`);
}
