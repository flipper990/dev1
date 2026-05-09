export const motion = {
  duration: {
    instant: '80ms',
    hover: '120ms',
    small: '160ms',
    panel: '220ms',
    layout: '320ms',
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
} as const;
