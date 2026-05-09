import type { Meta, StoryObj } from '@storybook/react';
import { deriveUnifiedProjectStatus } from '../model/project-status';
import { TrustSummaryPanel } from './TrustSummaryPanel';

const status = deriveUnifiedProjectStatus(null);

const meta: Meta<typeof TrustSummaryPanel> = { title: 'Phase3/TrustSummaryPanel', component: TrustSummaryPanel };
export default meta;
type Story = StoryObj<typeof TrustSummaryPanel>;

export const Healthy: Story = { args: { status: { ...status, label: 'Preview ready', healthy: true, tone: 'success', stage: 'verify', nextActionLabel: 'Run verification', key: 'preview-ready', description: '' } } };
export const Stale: Story = { args: { status: { ...status, label: 'Out of sync', healthy: false, tone: 'warning', stage: 'verify', nextActionLabel: 'Refresh', key: 'stale', description: '' }, stale: true } };
