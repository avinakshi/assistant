// Bundle the preload scripts into standalone CommonJS files.
//
// Why: Electron's sandboxed preload (`sandbox: true`) uses a restricted `preloadRequire`
// that can't resolve arbitrary `../`-style imports. Preload must ship as a single bundled
// file. tsc alone produces per-file output that still has `require('../shared/...')`
// statements — those break at runtime. esbuild flattens them.
//
// Kept as a standalone Node script (not integrated with Vite) so the preload build stays
// cheap + doesn't pull in Vite's dev-server footprint.

import { build } from 'esbuild';
import { resolve } from 'node:path';

const entries = ['overlay', 'settings'];

await Promise.all(
  entries.map((name) =>
    build({
      entryPoints: [resolve(`src/preload/${name}.ts`)],
      outfile: resolve(`dist/preload/${name}.js`),
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      // Electron's built-ins and Node built-ins stay external.
      external: ['electron'],
      sourcemap: true,
      logLevel: 'info',
    }),
  ),
);
