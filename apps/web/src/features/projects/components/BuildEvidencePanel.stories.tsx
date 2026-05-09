import type { Meta, StoryObj } from '@storybook/react';
import { BuildEvidencePanel } from './BuildEvidencePanel';

const meta: Meta<typeof BuildEvidencePanel> = { title: 'Phase3/BuildEvidencePanel', component: BuildEvidencePanel };
export default meta;
type Story = StoryObj<typeof BuildEvidencePanel>;

export const Loading: Story = { args: { checksPassed: 0, checksTotal: 2, runtimeMs: 12000, costUsd: 0.06 } };
export const Success: Story = { args: { checksPassed: 2, checksTotal: 2, runtimeMs: 72000, costUsd: 0.32 } };
export const Failure: Story = { args: { checksPassed: 1, checksTotal: 2, runtimeMs: 94000, costUsd: 0.41 } };
