import type { Meta, StoryObj } from '@storybook/react';
import type { GeneratedProject } from '../../../../types/dashboard';
import { deriveUnifiedProjectStatus } from '../model/project-status';
import { ProjectStatusSummary } from './ProjectStatusSummary';

const sample = {
  id: 'p1', sessionId: 's1', name: 'App', status: 'completed', prompts: [], totalTokens: 1, totalCostUsd: 0.1, durationMs: 1, createdAt: new Date().toISOString(),
  preview: { previewStatus: 'ready', previewReady: true },
} as unknown as GeneratedProject;

const meta: Meta<typeof ProjectStatusSummary> = { title: 'Phase3/ProjectStatusSummary', component: ProjectStatusSummary };
export default meta;
type Story = StoryObj<typeof ProjectStatusSummary>;

export const Loading: Story = {
  args: {
    status: deriveUnifiedProjectStatus({ ...sample, status: 'generating' } as GeneratedProject),
    buildHealthy: true,
    previewHealthy: false,
    verificationHealthy: false,
  },
};

export const Success: Story = {
  args: {
    status: deriveUnifiedProjectStatus(sample),
    buildHealthy: true,
    previewHealthy: true,
    verificationHealthy: true,
  },
};

export const Stale: Story = {
  args: {
    status: deriveUnifiedProjectStatus(sample, { forceStale: true }),
    buildHealthy: true,
    previewHealthy: false,
    verificationHealthy: false,
    stale: true,
  },
};

export const Failure: Story = {
  args: {
    status: deriveUnifiedProjectStatus({ ...sample, status: 'failed' } as GeneratedProject),
    buildHealthy: false,
    previewHealthy: false,
    verificationHealthy: false,
  },
};
