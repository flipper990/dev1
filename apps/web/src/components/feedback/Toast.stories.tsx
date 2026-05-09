import type { Meta, StoryObj } from '@storybook/react';
import { Toast } from './Toast';

const meta: Meta<typeof Toast> = { title: 'Phase4/Toast', component: Toast };
export default meta;
type Story = StoryObj<typeof Toast>;

export const Loading: Story = { args: { tone: 'info', title: 'Preparing preview', message: 'Runtime checks are in progress.' } };
export const Success: Story = { args: { tone: 'success', title: 'Verification passed', message: 'All checks completed successfully.' } };
export const Warning: Story = { args: { tone: 'warning', title: 'Verification pending', message: 'One approval remains.' } };
export const Error: Story = { args: { tone: 'error', title: 'Launch blocked', message: 'Security checks failed.' } };
export const Retrying: Story = { args: { tone: 'retrying', title: 'Retrying preview startup', message: 'Attempt 2 of 3.' } };
export const ReducedMotion: Story = { args: { tone: 'retrying', title: 'Retrying preview startup', reducedMotion: true } };
