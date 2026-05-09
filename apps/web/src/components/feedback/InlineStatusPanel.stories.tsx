import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../../../components/ui';
import { InlineStatusPanel } from './InlineStatusPanel';

const meta: Meta<typeof InlineStatusPanel> = { title: 'Phase4/InlineStatusPanel', component: InlineStatusPanel };
export default meta;
type Story = StoryObj<typeof InlineStatusPanel>;

export const Empty: Story = { args: { title: 'No status details', tone: 'neutral' } };
export const Warning: Story = {
  args: {
    tone: 'warning',
    title: 'Preview startup delayed',
    where: 'Workspace · Preview',
    whatWorked: 'Build artifacts generated successfully.',
    whatFailed: 'Runtime did not publish a healthy endpoint in time.',
    nextAction: 'Retry preview startup and inspect grouped logs.',
    actions: <Button>Retry preview</Button>,
  },
};
export const Error: Story = {
  args: {
    tone: 'error',
    title: 'Build failed',
    where: 'Build step · type checks',
    whatWorked: 'Dependency installation completed.',
    whatFailed: 'Type errors blocked build output.',
    nextAction: 'Fix blocking types and rerun build.',
  },
};
