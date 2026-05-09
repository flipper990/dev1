import type { Meta, StoryObj } from '@storybook/react';
import { LaunchChecklist } from './LaunchChecklist';

const meta: Meta<typeof LaunchChecklist> = { title: 'Phase4/LaunchChecklist', component: LaunchChecklist };
export default meta;
type Story = StoryObj<typeof LaunchChecklist>;

export const Empty: Story = { args: { items: [] } };
export const Success: Story = {
  args: {
    items: [
      { id: '1', label: 'Build complete', done: true },
      { id: '2', label: 'Preview healthy', done: true },
      { id: '3', label: 'Verification passed', done: true },
    ],
  },
};
export const Warning: Story = {
  args: {
    items: [
      { id: '1', label: 'Build complete', done: true },
      { id: '2', label: 'Preview healthy', done: false, note: 'Preview retry in progress.' },
      { id: '3', label: 'Verification passed', done: false },
    ],
  },
};
