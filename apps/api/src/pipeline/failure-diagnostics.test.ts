import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStructuredFailureDiagnostics } from './failure-diagnostics.js';

test('builder-empty failure includes actionable structured diagnostics', () => {
  const project: any = {
    files: [],
    diagnostics: {
      generationCheckpoints: [
        { id: 'slice-1/3:checkpoint', status: 'checkpointed' },
        { id: 'slice-2/3:recovered', status: 'recovered' },
      ],
      pipelineLedger: {
        records: [
          {
            phase: 'slice-2/3',
            stepId: 'builder:attempt-3',
            agentRole: 'builder',
            status: 'failed',
            errorCode: 'BUILDER_EMPTY_AFTER_FALLBACK',
            errorMessage: 'builder produced no files',
            retryCount: 2,
            outputArtifactSummary: '0 files',
          },
        ],
      },
    },
  };
  const out = buildStructuredFailureDiagnostics({
    project,
    failedPhase: 'slice-2/3',
    failedStep: 'builder:attempt-3',
    failedAgent: 'builder',
    failureReason: 'builder produced no files',
    retryCount: 2,
    filesGeneratedBeforeFailure: 0,
    recoveryAttempted: true,
  });

  assert.equal(out.failure.failureCategory, 'empty_generation');
  assert.equal(out.failure.zeroFileClassification, 'builder_empty_output');
  assert.equal(out.failure.retryCount, 2);
  assert.equal(out.failure.recoveryAttempted, true);
  assert.equal(out.failure.filesGeneratedBeforeFailure, 0);
  assert.ok(out.failure.recommendedNextAction.length > 0);
  assert.ok(Array.isArray((out.trace as any).phaseTimeline));
  assert.ok((out.trace as any).phaseTimeline.length > 0);
  assert.equal((out.trace as any).phaseTimeline[0].attempt, 0);
  assert.equal((out.trace as any).validationDecisions[0].validationVerdict, null);
  assert.ok(Array.isArray((out.trace as any).checkpoints));
  assert.equal((out.trace as any).checkpoints.length, 2);
});
