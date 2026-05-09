import type { Meta, StoryObj } from '@storybook/react';
import { RecoveryActions } from './RecoveryActions';

const meta: Meta<typeof RecoveryActions> = { title: 'Phase4/RecoveryActions', component: RecoveryActions };
export default meta;
type Story = StoryObj<typeof RecoveryActions>;

export const Default: Story = {};
export const Retrying: Story = { args: { retrying: true } };
