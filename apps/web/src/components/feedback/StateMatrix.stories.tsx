import type { Meta, StoryObj } from '@storybook/react';
import { Card } from '../../../components/ui';
import { InlineStatusPanel } from './InlineStatusPanel';
import { RecoveryActions } from './RecoveryActions';
import { SystemBanner } from './SystemBanner';
import { Toast } from './Toast';

const meta: Meta = {
  title: 'Phase4/StateMatrix',
};

export default meta;
type Story = StoryObj;

export const Matrix: Story = {
  render: () => (
    <div className="grid gap-3">
      <SystemBanner tone="info" title="Preview starting" description="Runtime checks are running." />
      <SystemBanner tone="success" title="Launch ready" description="Verification checks passed." />
      <SystemBanner tone="warning" title="Out of sync" description="Refresh status to reconcile signals." />
      <SystemBanner tone="error" title="Build failed" description="Type checks failed in compile step." />
      <InlineStatusPanel
        tone="warning"
        title="Retry flow"
        where="Preview startup"
        whatWorked="Artifacts generated"
        whatFailed="Health checks timed out"
        nextAction="Retry preview and inspect evidence"
        actions={<RecoveryActions retrying />}
      />
      <Card>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toast tone="retrying" title="Retrying" message="Attempt 2 of 3" />
          <Toast tone="retrying" title="Retrying" message="Reduced motion variant" reducedMotion />
        </div>
      </Card>
    </div>
  ),
};
