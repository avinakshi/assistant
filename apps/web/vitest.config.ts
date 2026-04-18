import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` is a no-op at runtime; Next's webpack maps it for client bundles but
      // outside Next there's no resolver for it. Point it at an empty shim for vitest.
      'server-only': fileURLToPath(new URL('./src/lib/test/server-only-shim.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Until we add Playwright E2E, the only tests are route-handler unit tests. Don't fail
    // CI just because a smoke file happens to be empty — `passWithNoTests` keeps the gate
    // honest without coupling to a specific test count.
    passWithNoTests: true,
  },
});
