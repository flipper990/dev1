import type { Meta, StoryObj } from '@storybook/react';
import { LogEvidenceView } from './LogEvidenceView';

const meta: Meta<typeof LogEvidenceView> = { title: 'Phase4/LogEvidenceView', component: LogEvidenceView };
export default meta;
type Story = StoryObj<typeof LogEvidenceView>;

export const Empty: Story = { args: { entries: [] } };
export const Loading: Story = {
  args: {
    entries: [
      { id: 'l1', timestamp: new Date().toISOString(), severity: 'info', step: 'Preview', message: 'Starting runtime process...' },
    ],
  },
};
export const Success: Story = {
  args: {
    entries: [
      { id: 'l2', timestamp: new Date().toISOString(), severity: 'info', step: 'Verify', message: 'All checks passed.' },
    ],
  },
};
export const Warning: Story = {
  args: {
    entries: [
      { id: 'l3', timestamp: new Date().toISOString(), severity: 'warning', step: 'Preview', message: 'First probe timed out.', explanation: 'Retry preview startup.' },
    ],
  },
};
export const Error: Story = {
  args: {
    entries: [
      { id: 'l4', timestamp: new Date().toISOString(), severity: 'error', step: 'Build', message: 'Type check failed.', explanation: 'Fix compile errors and rerun.' },
    ],
  },
};
export const Stale: Story = {
  args: {
    entries: [
      { id: 'l5', timestamp: new Date().toISOString(), severity: 'warning', step: 'Sync', message: 'State mismatch between preview and project record.', explanation: 'Refresh state and confirm health.' },
    ],
  },
};
