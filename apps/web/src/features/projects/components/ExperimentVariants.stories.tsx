import type { Meta, StoryObj } from '@storybook/react';
import { Card, Panel, Badge, Button } from '../../../../components/ui';
import { ProjectStatusSummary } from './ProjectStatusSummary';
import { ProjectCommandDock } from './ProjectCommandDock';
import { deriveUnifiedProjectStatus } from '../model/project-status';

const status = deriveUnifiedProjectStatus(null);

const meta: Meta = {
  title: 'Phase5/ExperimentVariants',
};

export default meta;
type Story = StoryObj;

export const StatusSummaryVariants: Story = {
  render: () => (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProjectStatusSummary
        status={{ ...status, label: 'Preview ready', stage: 'verify', healthy: true, tone: 'success', key: 'preview-ready', nextActionLabel: 'Run verification', description: 'Preview is healthy.' }}
        buildHealthy
        previewHealthy
        verificationHealthy={false}
      />
      <Panel title="Legacy status row" subtitle="Control variant">
        <div className="flex flex-wrap gap-2">
          <Badge variant="success">Build: completed</Badge>
          <Badge variant="warning">Preview: starting</Badge>
          <Badge variant="neutral">Verify: pending</Badge>
        </div>
      </Panel>
    </div>
  ),
};

export const CommandSurfaceVariants: Story = {
  render: () => (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProjectCommandDock />
      <Card>
        <h3 className="text-title-s text-ink">Legacy prompt composer</h3>
        <p className="mt-2 text-body-s text-secondary">Experiment control for submission behavior.</p>
        <div className="mt-4"><Button>Submit prompt</Button></div>
      </Card>
    </div>
  ),
};
