import type { Meta, StoryObj } from '@storybook/react';
import type { GeneratedProject } from '../../../../types/dashboard';
import { ProjectList } from './ProjectList';

const projects = [
  { id: '1', sessionId: 's1', name: 'Console app', status: 'completed', prompts: [], totalTokens: 1, totalCostUsd: 0.1, durationMs: 1, createdAt: new Date().toISOString(), preview: { previewStatus: 'ready', previewReady: true } },
  { id: '2', sessionId: 's2', name: 'Web app', status: 'generating', prompts: [], totalTokens: 1, totalCostUsd: 0.1, durationMs: 1, createdAt: new Date().toISOString(), preview: { previewStatus: 'building', previewReady: false } },
] as unknown as GeneratedProject[];

const meta: Meta<typeof ProjectList> = { title: 'Phase3/ProjectList', component: ProjectList };
export default meta;
type Story = StoryObj<typeof ProjectList>;

export const Empty: Story = { args: { projects: [] } };
export const Loading: Story = { args: { projects: projects.slice(1) } };
export const Success: Story = { args: { projects } };
