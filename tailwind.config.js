/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--elevated)',
        floating: 'var(--floating)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        'side-a': 'var(--side-a)',
        'side-b': 'var(--side-b)',
        'side-c': 'var(--side-c)',
        cta: 'var(--cta)',
        'on-cta': 'var(--on-cta)',
        link: 'var(--link)',
        highlight: 'var(--highlight)',
        gold: 'var(--gold)',
        good: 'var(--good)',
        bad: 'var(--bad)',
        warn: 'var(--warn)',
        awaiting: 'var(--awaiting)',
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
