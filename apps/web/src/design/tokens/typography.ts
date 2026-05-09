export const typography = {
  fontFamily: {
    sans: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
  },
  typeScale: {
    displayL: { fontSize: '40px', lineHeight: '48px', fontWeight: 600, letterSpacing: '-0.02em' },
    displayM: { fontSize: '32px', lineHeight: '40px', fontWeight: 600, letterSpacing: '-0.018em' },
    titleL: { fontSize: '24px', lineHeight: '32px', fontWeight: 600, letterSpacing: '-0.014em' },
    titleM: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.012em' },
    titleS: { fontSize: '18px', lineHeight: '26px', fontWeight: 600, letterSpacing: '-0.01em' },
    bodyL: { fontSize: '16px', lineHeight: '26px', fontWeight: 450, letterSpacing: '0' },
    bodyM: { fontSize: '15px', lineHeight: '24px', fontWeight: 450, letterSpacing: '0' },
    bodyS: { fontSize: '14px', lineHeight: '22px', fontWeight: 450, letterSpacing: '0' },
    labelM: { fontSize: '13px', lineHeight: '18px', fontWeight: 600, letterSpacing: '0' },
    labelS: { fontSize: '12px', lineHeight: '16px', fontWeight: 600, letterSpacing: '0.01em' },
    monoS: { fontSize: '12px', lineHeight: '18px', fontWeight: 500, letterSpacing: '0' },
  },
} as const;
