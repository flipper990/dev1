import type { Meta, StoryObj } from '@storybook/react';
import { ContextDrawer } from './ContextDrawer';

const meta: Meta<typeof ContextDrawer> = {
  title: 'Shell/ContextDrawer',
  component: ContextDrawer,
  args: {
    open: true,
    title: 'Project metadata',
    description: 'Secondary context',
    children: (
      <div className="space-y-2 text-body-s text-secondary">
        <p>Owner: Platform Team</p>
        <p>Region: eu-north-1</p>
        <p>Last deploy: 2 hours ago</p>
      </div>
    ),
    onClose: () => {},
  },
  decorators: [
    (Story: any) => (
      <div className="relative h-[640px] overflow-hidden border border-border">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ContextDrawer>;

export const Open: Story = {};

export const DarkMode: Story = {
  ...Open,
  globals: { theme: 'dark' },
};
