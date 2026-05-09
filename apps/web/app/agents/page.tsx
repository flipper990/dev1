'use client';

import { useEffect, useMemo } from 'react';
import { AppShell } from '../../src/components/shell';
import { Button, Card, Panel } from '../../components/ui';
import { getExperimentAssignments } from '../../src/lib/flags/uiRedesignFlags';
import { useTrackEvent } from '../../src/lib/telemetry/useTrackEvent';
import { ProductionTimeline } from '../../src/features/agents/components';

const EVENTS = [
  {
    id: '1',
    title: 'Spec approved',
    detail: 'Product requirements translated into implementation slices.',
    owner: 'Spec architect',
    tone: 'success' as const,
    runtime: '42s',
    cost: '$0.08',
  },
  {
    id: '2',
    title: 'Build completed',
    detail: 'Core workspace and API generated with typed contracts.',
    owner: 'Builder',
    tone: 'success' as const,
    runtime: '3m 16s',
    cost: '$0.42',
  },
  {
    id: '3',
    title: 'Verification pending',
    detail: 'Runtime probes identified one failing check requiring action.',
    owner: 'QA checks',
    tone: 'warning' as const,
    runtime: '58s',
    cost: '$0.05',
  },
];

export default function AgentsPage() {
  const trackEvent = useTrackEvent();
  const experiments = useMemo(() => getExperimentAssignments(), []);

  const timelineMode = experiments.activity_timeline_variant === 'production-timeline';

  useEffect(() => {
    trackEvent('ui_variant_exposed', {
      route: '/agents',
      variant: timelineMode ? 'production-timeline' : 'legacy-agent-feed',
    });
  }, [timelineMode, trackEvent]);

  return (
    <AppShell
      title="Activity"
      subtitle="Production evidence timeline with milestones, checks, and ownership."
      lifecycle={{ label: 'Verification pending', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/' }, { label: 'Activity' }]}
      actions={<Button>Open workspace</Button>}
      contextTitle="Accountability"
      contextContent={
        <Panel title="Ownership" subtitle="Who is accountable for each stage">
          <ul className="space-y-2 text-body-s text-secondary">
            <li>Decide: Product + Spec architect</li>
            <li>Build: Builder + Platform engineer</li>
            <li>Verify: QA checks + Reviewer</li>
            <li>Launch: Release owner</li>
          </ul>
        </Panel>
      }
      workspaceName="DEVteam Studio"
    >
      {timelineMode ? (
        <ProductionTimeline events={EVENTS} />
      ) : (
        <Card>
          <h3 className="text-title-s text-ink">Legacy agent feed</h3>
          <ul className="mt-3 space-y-2 text-body-s text-secondary">
            <li>Planner: Spec drafted</li>
            <li>Builder: Code generated</li>
            <li>QA: One check pending</li>
          </ul>
        </Card>
      )}
    </AppShell>
  );
}
