import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  render: () => (
    <EmptyState
      title="No projects yet"
      description="Start with a requirement prompt to generate your first workspace."
      action={<Button>New project</Button>}
    />
  ),
};

export const LightMode: Story = {
  ...Default,
  globals: { theme: 'light' },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
