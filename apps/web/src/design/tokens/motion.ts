export const motion = {
  duration: {
    hover: '100ms',
    press: '80ms',
    small: '160ms',
    drawer: '240ms',
    layout: '300ms',
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.2, 0.7, 0, 1)',
  },
} as const;
