import type { Meta, StoryObj } from '@storybook/react';
import { SyncWarningPanel } from './SyncWarningPanel';

const meta: Meta<typeof SyncWarningPanel> = { title: 'Phase4/SyncWarningPanel', component: SyncWarningPanel };
export default meta;
type Story = StoryObj<typeof SyncWarningPanel>;

export const Stale: Story = {};
export const Retrying: Story = { args: { retrying: true } };
