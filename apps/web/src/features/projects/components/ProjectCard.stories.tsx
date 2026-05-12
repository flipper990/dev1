import type { Meta, StoryObj } from '@storybook/react';
import type { GeneratedProject } from '../../../../types/dashboard';
import { ProjectCard } from './ProjectCard';

const base = {
  id: 'p1', sessionId: 's1', name: 'Storefront', status: 'generated', prompts: [], totalTokens: 4000, totalCostUsd: 1.2, durationMs: 60000, createdAt: new Date().toISOString(), preview: { previewStatus: 'ready', previewReady: true },
} as unknown as GeneratedProject;

const meta: Meta<typeof ProjectCard> = { title: 'Phase3/ProjectCard', component: ProjectCard };
export default meta;
type Story = StoryObj<typeof ProjectCard>;

export const Success: Story = { args: { project: base } };
export const Stale: Story = { args: { project: { ...base, status: 'failed', preview: { previewStatus: 'failed', previewReady: false } } as GeneratedProject } };
