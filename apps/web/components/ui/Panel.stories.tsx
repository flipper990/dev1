import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';
import { Panel } from './Panel';

const meta: Meta<typeof Panel> = {
  title: 'Primitives/Panel',
  component: Panel,
};

export default meta;
type Story = StoryObj<typeof Panel>;

export const Default: Story = {
  render: () => (
    <Panel
      title="Pipeline status"
      subtitle="Current execution state from API."
      actions={<Button size="sm" variant="secondary">Refresh</Button>}
    >
      <p className="text-body-s text-secondary">Spec and builder finished. QA is running.</p>
    </Panel>
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
