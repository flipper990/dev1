import type { Meta, StoryObj } from '@storybook/react';
import type { GeneratedProject } from '../../../../types/dashboard';
import { deriveUnifiedProjectStatus } from '../model/project-status';
import { ProjectHero } from './ProjectHero';

const sampleProject = {
  id: 'p1',
  sessionId: 's1',
  name: 'Customer portal',
  status: 'generated',
  prompts: [],
  totalTokens: 12000,
  totalCostUsd: 2.42,
  durationMs: 245000,
  createdAt: new Date().toISOString(),
  preview: { previewStatus: 'ready', previewReady: true },
} as unknown as GeneratedProject;

const meta: Meta<typeof ProjectHero> = {
  title: 'Phase3/ProjectHero',
  component: ProjectHero,
};

export default meta;
type Story = StoryObj<typeof ProjectHero>;

export const Empty: Story = {
  args: {
    project: null,
    status: deriveUnifiedProjectStatus(null),
  },
};

export const Success: Story = {
  args: {
    project: sampleProject,
    status: deriveUnifiedProjectStatus(sampleProject),
  },
};

export const Failure: Story = {
  args: {
    project: { ...sampleProject, status: 'failed', preview: { previewStatus: 'failed', previewReady: false } } as GeneratedProject,
    status: deriveUnifiedProjectStatus({ ...sampleProject, status: 'failed', preview: { previewStatus: 'failed', previewReady: false } } as GeneratedProject),
  },
};
