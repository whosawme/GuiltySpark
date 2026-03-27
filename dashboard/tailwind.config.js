/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'gs-bg': '#0b0f1a',
        'gs-surface': '#111827',
        'gs-border': '#1e2d3d',
        'gs-text': '#94a3b8',
        'gs-heading': '#e2e8f0',
        'gs-accent': '#22d3ee',
        'gs-red': '#f87171',
        'gs-yellow': '#fbbf24',
        'gs-green': '#34d399',
        'gs-purple': '#a78bfa',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
