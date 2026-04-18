import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 10_000,
    // environmentMatchGlobs lets main-side tests stay in node while tsx tests run in jsdom.
    environmentMatchGlobs: [
      ['src/renderer/**', 'jsdom'],
      ['**', 'node'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/main/index.ts',
        'src/renderer/**/main.tsx',
        'src/renderer/types/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
});
