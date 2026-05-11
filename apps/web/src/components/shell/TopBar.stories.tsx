import type { Meta, StoryObj } from '@storybook/react';
import { TopBar } from './TopBar';

const meta: Meta<typeof TopBar> = {
  title: 'Shell/TopBar',
  component: TopBar,
  args: {
    workspaceName: 'DEVteam Studio',
    platformHealth: 'online',
  },
};

export default meta;
type Story = StoryObj<typeof TopBar>;

export const Default: Story = {};

export const DarkMode: Story = {
  globals: { theme: 'dark' },
};
