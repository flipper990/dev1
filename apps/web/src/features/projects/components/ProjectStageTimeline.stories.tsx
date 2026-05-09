import type { Meta, StoryObj } from '@storybook/react';
import { ProjectStageTimeline } from './ProjectStageTimeline';
import type { WorkflowTimelineViewModel } from '../model';

const meta: Meta<typeof ProjectStageTimeline> = { title: 'Phase3/ProjectStageTimeline', component: ProjectStageTimeline };
export default meta;
type Story = StoryObj<typeof ProjectStageTimeline>;

function makeTimeline(currentStepId: WorkflowTimelineViewModel['currentStepId']): WorkflowTimelineViewModel {
  const makeStep = (
    id: WorkflowTimelineViewModel['currentStepId'],
    label: string,
    description: string,
  ) => ({
    id,
    label,
    description,
    state: id === currentStepId ? 'running' : ['input', 'build', 'preview', 'verify', 'launch'].indexOf(id) < ['input', 'build', 'preview', 'verify', 'launch'].indexOf(currentStepId) ? 'success' : 'pending',
  } as const);

  return {
    heading: 'Build workflow timeline',
    summary: 'Track lifecycle progress from input through launch.',
    currentStepId,
    overallTone: 'active',
    steps: [
      makeStep('input', 'Input received', 'Requirements captured for this cycle.'),
      makeStep('build', 'Generate code', 'Agent pipeline produces artifacts.'),
      makeStep('preview', 'Start preview', 'Runtime boot and health checks.'),
      makeStep('verify', 'Verify quality', 'Run execution and runtime checks.'),
      makeStep('launch', 'Launch decision', 'Approve deployment readiness.'),
    ],
  };
}

export const Decide: Story = { args: { timeline: makeTimeline('input') } };
export const Build: Story = { args: { timeline: makeTimeline('build') } };
export const Verify: Story = { args: { timeline: makeTimeline('verify') } };
export const Launch: Story = { args: { timeline: makeTimeline('launch') } };
