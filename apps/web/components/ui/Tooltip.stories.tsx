import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Primitives/Tooltip',
  component: Tooltip,
  render: (args) => (
    <div className="p-10">
      <Tooltip {...args}>
        <Button variant="secondary">Hover or focus</Button>
      </Tooltip>
    </div>
  ),
  args: {
    tooltipContent: 'Project metadata and diagnostics are available in the context panel.',
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {};

export const LightMode: Story = {
  ...Default,
  globals: { theme: 'light' },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
