import type { Meta, StoryObj } from '@storybook/react';
import { ProjectStageTimeline } from './ProjectStageTimeline';

const meta: Meta<typeof ProjectStageTimeline> = { title: 'Phase3/ProjectStageTimeline', component: ProjectStageTimeline };
export default meta;
type Story = StoryObj<typeof ProjectStageTimeline>;

export const Decide: Story = { args: { currentStage: 'decide' } };
export const Build: Story = { args: { currentStage: 'build' } };
export const Verify: Story = { args: { currentStage: 'verify' } };
export const Launch: Story = { args: { currentStage: 'launch' } };
