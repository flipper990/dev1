import type { Preview } from '@storybook/react';
import '../app/globals.css';
import '../src/styles/theme.css';

const preview: Preview = {
  globalTypes: {
    theme: {
      name: 'Theme',
      defaultValue: 'light',
      toolbar: {
        icon: 'paintbrush',
        items: ['light', 'dark'],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme;
      return (
        <div
          data-theme={theme}
          className={theme === 'dark' ? 'theme-dark min-h-screen p-6' : 'min-h-screen p-6'}
          style={{ background: 'var(--color-surface-base)' }}
        >
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    controls: { expanded: true },
    a11y: { test: 'todo' },
  },
};

export default preview;
