import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Until we add Playwright E2E, the only tests are route-handler unit tests. Don't fail
    // CI just because a smoke file happens to be empty — `passWithNoTests` keeps the gate
    // honest without coupling to a specific test count.
    passWithNoTests: true,
  },
});
