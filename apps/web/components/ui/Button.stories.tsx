import type { Meta, StoryObj } from '@storybook/react';
import { Save } from 'lucide-react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  args: {
    children: 'Generate build',
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {};

export const Hover: Story = {
  args: {
    className: '!bg-primary-hover',
  },
};

export const Focus: Story = {
  args: {
    autoFocus: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const Loading: Story = {
  args: {
    loading: true,
  },
};

export const Success: Story = {
  args: {
    variant: 'success',
    children: 'Published',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    children: 'Review required',
  },
};

export const Error: Story = {
  args: {
    variant: 'danger',
    children: 'Failed step',
  },
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Save className="h-4 w-4" />
        Save draft
      </>
    ),
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
