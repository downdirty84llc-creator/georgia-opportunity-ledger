import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Ledger palette: deep pine (Georgia forestry) + clay accent.
        /**
         * Contrast against white, for text (WCAG 1.4.3 wants 4.5:1 for body
         * copy, 3:1 for large text and UI boundaries):
         *
         *   ink-300  2.21:1  borders and dividers only
         *   ink-400  3.70:1  large text, icons, decorative — NOT body copy
         *   ink-500  5.76:1  the lightest token safe for ordinary text
         *   ink-600  7.99:1
         *   ink-700  9.97:1, and darker above that
         *
         * `text-ink-400` on a light surface fails AA and has done so twice;
         * `tests/e2e/accessibility.spec.ts` now catches it. Reach for ink-500
         * when the instinct is "this should look quieter".
         *
         * These figures are asserted in `tests/unit/design/palette.test.ts`,
         * computed from the tokens below rather than trusted from this
         * comment — which was wrong about ink-300 until the test was written.
         * The brand is signed off, so a hex change here is a deliberate act
         * and the test is what makes it one.
         */
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
