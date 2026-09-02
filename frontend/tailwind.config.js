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
        card: '0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)',
      },
    },
  },
  plugins: [],
}
