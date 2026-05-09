'use client';

import { useState } from 'react';
import { Button, Card } from '../../../../components/ui';
import { ProjectStageTimeline } from '../../projects/components/ProjectStageTimeline';

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
  const step = DEFAULT_STEPS[index];

  return (
    <Card>
      <h3 className="text-title-s text-ink">Onboarding</h3>
      <p className="mt-1 text-body-s text-secondary">Learn how to operate DEVteam like a production studio.</p>

      <div className="mt-4">
        <ProjectStageTimeline currentStage={index === 0 ? 'decide' : index === 1 ? 'build' : 'verify'} />
      </div>

      <section className="mt-4 rounded-[var(--radius-control)] border border-border bg-surface-tint p-3" aria-live="polite">
        <h4 className="text-label-m text-ink">{step.title}</h4>
        <p className="mt-1 text-body-s text-secondary">{step.detail}</p>
      </section>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={index === 0} onClick={() => setIndex((prev) => Math.max(0, prev - 1))}>
          Back
        </Button>
        {index < DEFAULT_STEPS.length - 1 ? (
          <Button onClick={() => setIndex((prev) => Math.min(DEFAULT_STEPS.length - 1, prev + 1))}>Next</Button>
        ) : (
          <Button onClick={onComplete}>Finish setup</Button>
        )}
      </div>
    </Card>
  );
}
