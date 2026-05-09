export const typography = {
  fontFamily: {
    sans: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
  },
  typeScale: {
    displayL: { fontSize: '40px', lineHeight: '48px', fontWeight: 600 },
    displayM: { fontSize: '32px', lineHeight: '40px', fontWeight: 600 },
    titleL: { fontSize: '24px', lineHeight: '32px', fontWeight: 600 },
    titleM: { fontSize: '20px', lineHeight: '28px', fontWeight: 600 },
    titleS: { fontSize: '18px', lineHeight: '26px', fontWeight: 600 },
    bodyL: { fontSize: '16px', lineHeight: '26px', fontWeight: 450 },
    bodyM: { fontSize: '15px', lineHeight: '24px', fontWeight: 450 },
    bodyS: { fontSize: '14px', lineHeight: '22px', fontWeight: 450 },
    labelM: { fontSize: '13px', lineHeight: '18px', fontWeight: 550 },
    labelS: { fontSize: '12px', lineHeight: '16px', fontWeight: 550 },
    monoS: { fontSize: '12px', lineHeight: '18px', fontWeight: 500 },
  },
  letterSpacing: {
    normal: '0',
  },
} as const;
