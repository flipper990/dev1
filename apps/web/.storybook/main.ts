import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  stories: [
    '../components/**/*.stories.@(ts|tsx)',
    '../src/components/**/*.stories.@(ts|tsx)',
    '../src/features/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  staticDirs: [],
};

export default config;
