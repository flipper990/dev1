'use client';

import { useState } from 'react';
import { Button, Card } from '../../../../components/ui';
import { ProjectStageTimeline } from '../../projects/components/ProjectStageTimeline';
import type { WorkflowTimelineViewModel } from '../../projects/model';

const DEFAULT_STEPS = [
  {
    id: '1',
    title: 'Understand lifecycle',
    detail: 'DEVteam moves through Decide, Build, Verify, and Launch.',
  },
  {
    id: '2',
    title: 'Know ownership',
    detail: 'You own scope, acceptance criteria, and release decisions.',
  },
  {
    id: '3',
    title: 'Interpret health',
    detail: 'Preview and verification states indicate launch readiness.',
  },
];

interface SetupStepperProps {
  onComplete?: () => void;
}

export function SetupStepper({ onComplete }: SetupStepperProps) {
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(false);
  const step = DEFAULT_STEPS[index];
  const timeline: WorkflowTimelineViewModel = {
    heading: 'Onboarding workflow',
    summary: 'Learn the operating lifecycle used across DEVteam.',
    currentStepId: index === 0 ? 'input' : index === 1 ? 'build' : 'verify',
    overallTone: 'active',
    steps: [
      {
        id: 'input',
        label: 'Decide',
        description: 'Capture requirements and success criteria.',
        state: index === 0 ? 'running' : 'success',
      },
      {
        id: 'build',
        label: 'Build',
        description: 'Generate implementation artifacts.',
        state: index === 1 ? 'running' : index > 1 ? 'success' : 'pending',
      },
      {
        id: 'verify',
        label: 'Verify',
        description: 'Validate behavior and quality.',
        state: index === 2 ? 'running' : 'pending',
      },
      {
        id: 'launch',
        label: 'Launch',
        description: 'Approve and release to production.',
        state: 'pending',
      },
    ],
  };

  return (
    <Card>
      <h3 className="text-title-s text-text-primary">Onboarding</h3>
      <p className="mt-1 text-body-s text-text-secondary">Learn how to operate DEVteam like a production studio.</p>

      <div className="mt-4">
        <ProjectStageTimeline timeline={timeline} />
      </div>

      <section className="mt-4 rounded-[var(--radius-control)] border border-border bg-surface-tint p-3" aria-live="polite">
        <h4 className="text-label-m text-text-primary">{completed ? 'Setup guide completed' : step.title}</h4>
        <p className="mt-1 text-body-s text-text-secondary">
          {completed ? 'This local onboarding guide is complete. Workspace settings still require backend persistence before they can be saved.' : step.detail}
        </p>
      </section>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={index === 0} onClick={() => setIndex((prev) => Math.max(0, prev - 1))}>
          Back
        </Button>
        {index < DEFAULT_STEPS.length - 1 ? (
          <Button onClick={() => setIndex((prev) => Math.min(DEFAULT_STEPS.length - 1, prev + 1))}>Next</Button>
        ) : (
          <Button
            disabled={completed && !onComplete}
            title={completed && !onComplete ? 'Setup guide is already complete. Workspace persistence is not connected.' : undefined}
            onClick={() => {
              setCompleted(true);
              onComplete?.();
            }}
          >
            {completed ? 'Setup guide complete' : 'Finish setup'}
          </Button>
        )}
      </div>
    </Card>
  );
}
