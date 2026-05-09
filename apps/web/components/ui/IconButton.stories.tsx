import type { Meta, StoryObj } from '@storybook/react';
import { RefreshCw } from 'lucide-react';
import { IconButton } from './IconButton';

const meta: Meta<typeof IconButton> = {
  title: 'Primitives/IconButton',
  component: IconButton,
  args: {
    icon: <RefreshCw className="h-4 w-4" />,
    label: 'Refresh',
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {};

export const Hover: Story = {
  args: {
    className: '!bg-surface-tint',
  },
};

export const Focus: Story = {
  args: { autoFocus: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Loading: Story = {
  args: { loading: true },
};

export const LightMode: Story = {
  ...Default,
  globals: { theme: 'light' },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
