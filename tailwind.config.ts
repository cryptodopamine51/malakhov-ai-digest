import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        base:    'var(--base)',
        surface: 'var(--surface)',
        ink:     'var(--ink)',
        muted:   'var(--muted)',
        'hero-muted': 'var(--hero-muted)',
        line:    'var(--line)',
        accent:  'var(--accent)',
        russia:  '#dc2626',
        footer:  '#0a0a0a',
      },
      fontFamily: {
        sans:  ['var(--font-golos)',  ...defaultTheme.fontFamily.sans],
        serif: ['var(--font-onest)',  ...defaultTheme.fontFamily.sans],
        mono:  ['var(--font-mono)',   ...defaultTheme.fontFamily.mono],
      },
      borderRadius: {
        sm:    '3px',
        DEFAULT: '4px',
        md:    '4px',
        lg:    '4px',
        xl:    '4px',
        '2xl': '4px',
        full:  '9999px',
      },
    },
  },
  plugins: [],
}

export default config
