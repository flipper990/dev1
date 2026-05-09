import type { Meta, StoryObj } from '@storybook/react';
import { StatusDot } from './StatusDot';

const meta: Meta<typeof StatusDot> = {
  title: 'Primitives/StatusDot',
  component: StatusDot,
};

export default meta;
type Story = StoryObj<typeof StatusDot>;

export const Default: Story = {
  args: { tone: 'neutral', label: 'Queued' },
};

export const Success: Story = {
  args: { tone: 'success', label: 'Healthy' },
};

export const Warning: Story = {
  args: { tone: 'warning', label: 'Retrying' },
};

export const Error: Story = {
  args: { tone: 'error', label: 'Blocked' },
};

export const Active: Story = {
  args: { tone: 'active', label: 'Starting' },
};

export const UnifiedStatusKey: Story = {
  args: { statusKey: 'preview-ready' },
};

export const LightMode: Story = {
  ...Default,
  globals: { theme: 'light' },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
