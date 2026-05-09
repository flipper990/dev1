import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../../../components/ui';
import { SystemBanner } from './SystemBanner';

const meta: Meta<typeof SystemBanner> = { title: 'Phase4/SystemBanner', component: SystemBanner };
export default meta;
type Story = StoryObj<typeof SystemBanner>;

export const Loading: Story = { args: { tone: 'info', title: 'Preview starting', description: 'Booting runtime and waiting for health checks.' } };
export const Success: Story = { args: { tone: 'success', title: 'Build complete', description: 'Artifacts generated and validated.' } };
export const Warning: Story = { args: { tone: 'warning', title: 'Verification pending', description: 'Manual approval is still required.' } };
export const Error: Story = {
  args: {
    tone: 'error',
    title: 'Preview failed',
    description: 'Server exited before health checks passed.',
    actions: <Button variant="secondary">Open logs</Button>,
  },
};
