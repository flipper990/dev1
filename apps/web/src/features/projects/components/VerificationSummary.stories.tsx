import type { Meta, StoryObj } from '@storybook/react';
import { VerificationSummary } from './VerificationSummary';

const meta: Meta<typeof VerificationSummary> = { title: 'Phase4/VerificationSummary', component: VerificationSummary };
export default meta;
type Story = StoryObj<typeof VerificationSummary>;

export const Loading: Story = { args: { runtimeStatus: 'pending', qaStatus: 'pending', securityStatus: 'pending' } };
export const Success: Story = { args: { runtimeStatus: 'passed', qaStatus: 'passed', securityStatus: 'passed' } };
export const Error: Story = { args: { runtimeStatus: 'failed', qaStatus: 'pending', securityStatus: 'pending' } };
