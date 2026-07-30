import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Ledger palette: deep pine (Georgia forestry) + clay accent.
        ink: {
          50: '#f5f7f7',
          100: '#e3e9e9',
          200: '#c7d3d3',
          300: '#9fb2b2',
          400: '#6f8a8a',
          500: '#4f6b6b',
          600: '#3d5555',
          700: '#334646',
          800: '#2c3b3b',
          900: '#1a2424',
          950: '#0e1616',
        },
        clay: {
          50: '#fdf5f3',
          100: '#fbe8e4',
          200: '#f8d5cd',
          300: '#f2b7a9',
          400: '#e88d77',
          500: '#da6749',
          600: '#c44e2f',
          700: '#a43e25',
          800: '#883623',
          900: '#723123',
        },
        signal: {
          immediate: '#b91c1c',
          strong: '#c2410c',
          investigate: '#a16207',
          limited: '#4d7c0f',
          info: '#475569',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      maxWidth: {
        prose: '68ch',
      },
    },
  },
  plugins: [],
};

export default config;
