import type { Config } from 'tailwindcss';

/**
 * Cosmic / Editorial dashboard theme.
 *
 *   - Deep midnight canvas with a faint starfield + nebula glow.
 *   - Warm gold (amber) primary accent — active nav, CTAs, level badges.
 *   - Soft violet secondary accent — sparkle / AI surfaces.
 *   - Editorial serif (Fraunces) for display, Inter for UI, JetBrains Mono for code.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink:        '#07090F',
        'ink-1':    '#0B0F1C',
        'ink-2':    '#11162A',
        'ink-3':    '#181E36',

        bg:         '#07090F',
        surface:    '#0F1424',
        elevated:   '#161C32',
        border:     'rgba(255,255,255,0.07)',
        'border-strong': 'rgba(255,255,255,0.14)',

        gold: {
          50:  '#FBF4E4',
          100: '#F4E4BD',
          200: '#ECD08C',
          300: '#E2BB5A',
          400: '#D7A538',
          500: '#C99030',
          600: '#A8762A',
          700: '#7A551E',
          800: '#503713',
          900: '#2A1C09',
        },

        violet: {
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
        },

        success:  '#22C55E',
        warning:  '#F59E0B',
        error:    '#EF4444',
        info:     '#38BDF8',

        primary:   '#F8FAFC',
        secondary: '#CBD5E1',
        muted:     '#7B8197',
        dimmed:    '#4A5269',

        'agent-spec':     '#FBBF24',
        'agent-builder':  '#60A5FA',
        'agent-qa':       '#C084FC',
        'agent-polish':   '#4ADE80',
        'agent-planner':  '#FBBF24',
        'agent-coder':    '#60A5FA',
        'agent-reviewer': '#C084FC',
        'agent-tester':   '#4ADE80',
        'agent-devops':   '#FB7185',
      },

      fontFamily: {
        display: ['var(--font-display)', 'Fraunces', '"Cormorant Garamond"', 'Georgia', 'serif'],
        serif:   ['var(--font-display)', 'Fraunces', 'Georgia', 'serif'],
        sans:    ['var(--font-sans)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"SF Mono"', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs:    ['11px', { lineHeight: '16px' }],
        sm:    ['12px', { lineHeight: '18px' }],
        base:  ['13px', { lineHeight: '20px' }],
        md:    ['14px', { lineHeight: '22px' }],
        lg:    ['16px', { lineHeight: '24px' }],
        xl:    ['18px', { lineHeight: '26px' }],
        '2xl': ['22px', { lineHeight: '30px' }],
        '3xl': ['28px', { lineHeight: '36px' }],
        '4xl': ['36px', { lineHeight: '44px' }],
        '5xl': ['48px', { lineHeight: '56px' }],
      },

      borderRadius: {
        sm:    '6px',
        DEFAULT: '8px',
        md:    '10px',
        lg:    '14px',
        xl:    '18px',
        '2xl': '22px',
        '3xl': '28px',
      },

      boxShadow: {
        card:     '0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.4)',
        'card-lg':'0 1px 0 rgba(255,255,255,0.05) inset, 0 8px 28px rgba(0,0,0,0.45)',
        gold:     '0 0 0 1px rgba(201,144,48,0.45), 0 6px 20px rgba(201,144,48,0.20)',
        'gold-sm':'0 0 0 1px rgba(201,144,48,0.40), 0 2px 10px rgba(201,144,48,0.18)',
        glow:     '0 0 24px rgba(201,144,48,0.25)',
        'inner-soft': 'inset 0 1px 4px rgba(0,0,0,0.3)',
      },

      backgroundImage: {
        'cosmic':
          'radial-gradient(80rem 36rem at 70% -10%, rgba(201,144,48,0.13), transparent 60%),' +
          'radial-gradient(60rem 30rem at 10% -8%, rgba(139,92,246,0.10), transparent 60%),' +
          'radial-gradient(50rem 24rem at 50% 110%, rgba(56,189,248,0.04), transparent 60%)',
        'gold-grad':
          'linear-gradient(135deg, #E2BB5A 0%, #C99030 50%, #A8762A 100%)',
        'gold-grad-soft':
          'linear-gradient(135deg, rgba(226,187,90,0.18) 0%, rgba(201,144,48,0.10) 100%)',
      },

      keyframes: {
        shimmer:         { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        'pulse-ring':    { '0%': { transform: 'scale(0.7)', opacity: '0.6' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
        'pipe-flow':     { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(200%)' } },
        'spin-slow':     { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
        'fade-in-up':    { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right':{ '0%': { opacity: '0', transform: 'translateX(20px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        'pulse-dot':     { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        twinkle:         { '0%, 100%': { opacity: '0.25' }, '50%': { opacity: '1' } },
      },
      animation: {
        shimmer:         'shimmer 1.6s ease-in-out infinite',
        'pulse-ring':    'pulse-ring 1.4s ease-out infinite',
        'pipe-flow':     'pipe-flow 1.2s linear infinite',
        'spin-slow':     'spin-slow 0.7s linear infinite',
        'fade-in-up':    'fade-in-up 200ms ease-out',
        'slide-in-right':'slide-in-right 200ms ease-out',
        'pulse-dot':     'pulse-dot 1.8s ease-in-out infinite',
        twinkle:         'twinkle 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
