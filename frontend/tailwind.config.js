/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        navy: {
          950: '#0a141f',
          900: '#0d1b29',
          800: '#132436',
          700: '#1a3049',
          600: '#22405f',
        },
        teal: {
          500: '#2a9d8f',
          400: '#45b3a5',
          300: '#7ecdc2',
        },
        status: {
          pass: '#1a7f4c',
          passBg: '#e5f6ec',
          ordered: '#92650a',
          orderedBg: '#fdf1cf',
          blocked: '#b3261e',
          blockedBg: '#fbe4e2',
          idle: '#5c6b7a',
          idleBg: '#eef1f4',
        },
      },
      boxShadow: {
        card: 'inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 1px 2px rgba(16, 24, 40, 0.04), 0 10px 24px -14px rgba(16, 24, 40, 0.14)',
        float: '0 2px 6px rgba(16, 24, 40, 0.06), 0 24px 48px -20px rgba(16, 24, 40, 0.28)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.4, 0.5, 1)',
      },
    },
  },
  plugins: [],
}
