import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:       '#0B0F19',
        surface:  '#151B2B',
        elevated: '#1E293B',
        border:   'rgba(255,255,255,0.06)',
        accent:   '#3B82F6',
        success:  '#22C55E',
        warning:  '#F59E0B',
        error:    '#EF4444',
        primary:   '#F1F5F9',
        secondary: '#94A3B8',
        muted:     '#64748B',
        dimmed:    '#475569',
        // Agent
        'agent-planner':  '#FBBF24',
        'agent-coder':    '#60A5FA',
        'agent-reviewer': '#C084FC',
        'agent-tester':   '#4ADE80',
        'agent-devops':   '#FB7185',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs:    ['11px', { lineHeight: '16px' }],
        sm:    ['12px', { lineHeight: '18px' }],
        base:  ['13px', { lineHeight: '20px' }],
        md:    ['14px', { lineHeight: '22px' }],
        lg:    ['16px', { lineHeight: '24px' }],
      },
      borderRadius: {
        sm:  '4px',
        DEFAULT: '6px',
        md:  '8px',
        lg:  '10px',
        xl:  '14px',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        'pulse-ring': {
          '0%':   { transform: 'scale(0.7)', opacity: '0.6' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'pipe-flow': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        'fade-in-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%':   { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        'fill-line': {
          from: { strokeDashoffset: '100' },
          to:   { strokeDashoffset: '0' },
        },
        'green-flash': {
          '0%':   { background: '#3B82F6' },
          '50%':  { background: '#22C55E' },
          '100%': { background: '#3B82F6' },
        },
      },
      animation: {
        shimmer:         'shimmer 1.6s ease-in-out infinite',
        'pulse-ring':    'pulse-ring 1.4s ease-out infinite',
        'pipe-flow':     'pipe-flow 1.2s linear infinite',
        'spin-slow':     'spin-slow 0.7s linear infinite',
        'fade-in-up':    'fade-in-up 200ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
        'pulse-dot':     'pulse-dot 1.8s ease-in-out infinite',
        'green-flash':   'green-flash 600ms ease-out forwards',
      },
      boxShadow: {
        card:    '0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        glow:    '0 0 20px rgba(59,130,246,0.3)',
        'glow-sm': '0 0 10px rgba(59,130,246,0.2)',
        inner:   'inset 0 1px 4px rgba(0,0,0,0.3)',
        panel:   '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
