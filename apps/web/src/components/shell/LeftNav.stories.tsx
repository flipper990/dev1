import type { Meta, StoryObj } from '@storybook/react';
import { LeftNav } from './LeftNav';

const meta: Meta<typeof LeftNav> = {
  title: 'Shell/LeftNav',
  component: LeftNav,
  args: {
    currentPath: '/projects',
  },
  decorators: [
    (Story: any) => (
      <div className="h-[640px] border border-border">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof LeftNav>;

export const Default: Story = {};

export const Collapsed: Story = {
  args: {
    collapsed: true,
  },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
