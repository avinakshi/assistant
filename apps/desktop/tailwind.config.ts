import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Overlay palette — dark, semi-transparent, subdued.
        overlay: {
          bg: 'rgba(15, 18, 24, 0.85)',
          border: 'rgba(255, 255, 255, 0.08)',
          text: 'rgba(240, 240, 248, 0.95)',
          dim: 'rgba(180, 184, 195, 0.7)',
          accent: 'rgb(94, 162, 255)',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
