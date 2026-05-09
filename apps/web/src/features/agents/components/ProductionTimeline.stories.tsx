import type { Meta, StoryObj } from '@storybook/react';
import { Card } from '../../../../components/ui';
import { ProductionTimeline } from './ProductionTimeline';

const events = [
  { id: '1', title: 'Build completed', detail: 'Artifacts generated.', owner: 'Builder', tone: 'success' as const, runtime: '2m', cost: '$0.20' },
  { id: '2', title: 'Verification pending', detail: 'Need approval.', owner: 'QA', tone: 'warning' as const },
];

const meta: Meta<typeof ProductionTimeline> = { title: 'Phase3/ProductionTimeline', component: ProductionTimeline };
export default meta;
type Story = StoryObj<typeof ProductionTimeline>;

export const Empty: Story = { args: { events: [] } };
export const Success: Story = { args: { events } };
export const Failure: Story = { args: { events: [{ id: '3', title: 'Launch blocked', detail: 'Critical check failed.', owner: 'Release', tone: 'error' }] } };

export const LegacyFeedVariant: Story = {
  render: () => (
    <Card>
      <h3 className="text-title-s text-ink">Legacy agent feed</h3>
      <ul className="mt-3 space-y-2 text-body-s text-secondary">
        <li>Planner: Spec drafted</li>
        <li>Builder: Code generated</li>
        <li>QA: One check pending</li>
      </ul>
    </Card>
  ),
};
