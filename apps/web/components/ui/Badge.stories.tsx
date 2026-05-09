import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    children: 'Draft',
    variant: 'neutral',
  },
};

export const Success: Story = {
  args: {
    children: 'Completed',
    variant: 'success',
  },
};

export const Warning: Story = {
  args: {
    children: 'Needs attention',
    variant: 'warning',
  },
};

export const Error: Story = {
  args: {
    children: 'Failed',
    variant: 'error',
  },
};

export const Active: Story = {
  args: {
    children: 'Starting',
    variant: 'active',
  },
};

export const UnifiedStatusKey: Story = {
  args: {
    statusKey: 'preview-failed',
  },
};

export const LightMode: Story = {
  ...Default,
  globals: { theme: 'light' },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
