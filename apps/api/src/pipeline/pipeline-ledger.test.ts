import assert from 'node:assert/strict';
import test from 'node:test';

import type { PipelineEvent } from '../../../../packages/agent-core/src/pipeline-types.js';
import {
  applyPipelineLedgerEvent,
  createPipelineRunLedger,
  summarizeOutputArtifact,
} from './pipeline-ledger.js';

const baseContext = {
  projectId: 'project-123',
  sessionId: 'session-123',
  phase: 'slice-1/2',
};

test('pipeline ledger records running, retry, validation, and completion transitions', () => {
  let ledger = createPipelineRunLedger(baseContext.projectId, baseContext.sessionId, '2026-05-11T10:00:00.000Z');

  ledger = applyPipelineLedgerEvent(ledger, {
    type: 'step:started',
    sessionId: baseContext.sessionId,
    stepId: 'build',
    stepName: 'Build',
    agent: 'builder',
    description: 'Build app',
    stepIndex: 1,
    totalSteps: 4,
  }, { ...baseContext, now: '2026-05-11T10:00:01.000Z' });

  ledger = applyPipelineLedgerEvent(ledger, {
    type: 'step:retrying',
    sessionId: baseContext.sessionId,
    stepId: 'build',
    agent: 'builder',
    attempt: 2,
    maxAttempts: 3,
    error: 'Provider timeout',
  }, { ...baseContext, now: '2026-05-11T10:00:02.000Z' });

  ledger = applyPipelineLedgerEvent(ledger, {
    type: 'step:validated',
    sessionId: baseContext.sessionId,
    stepId: 'build',
    agent: 'builder',
    verdict: 'repaired',
    issueCount: 1,
    repairCount: 1,
    issues: [{ id: 'missing-field', message: 'Defaulted field', severity: 'warning', category: 'shape' }],
  }, { ...baseContext, now: '2026-05-11T10:00:03.000Z' });

  ledger = applyPipelineLedgerEvent(ledger, {
    type: 'step:completed',
    sessionId: baseContext.sessionId,
    stepId: 'build',
    agent: 'builder',
    durationMs: 2500,
    stepIndex: 1,
    totalSteps: 4,
    usage: {
      model: 'claude-sonnet-4',
      provider: 'anthropic',
      tokensIn: 1200,
      tokensOut: 800,
      totalTokens: 2000,
      costUsd: 0.018,
    },
    artifactSummary: summarizeOutputArtifact({
      files: [{ path: 'src/app/page.tsx', content: 'export default function Page() { return null; }' }],
      summary: 'Built the page.',
    }),
  }, { ...baseContext, now: '2026-05-11T10:00:04.000Z' });

  assert.equal(ledger.records.length, 1);
  const record = ledger.records[0];
  assert.equal(record.status, 'completed');
  assert.equal(record.attempt, 2);
  assert.equal(record.retryCount, 1);
  assert.equal(record.validationResult?.verdict, 'repaired');
  assert.equal(record.validationResult?.repairCount, 1);
  assert.equal(record.model, 'claude-sonnet-4');
  assert.equal(record.provider, 'anthropic');
  assert.equal(record.inputTokens, 1200);
  assert.equal(record.outputTokens, 800);
  assert.equal(record.costUsd, 0.018);
  assert.equal(record.outputArtifactSummary?.files?.count, 1);
  assert.equal(record.outputArtifactSummary?.summary, 'Built the page.');
});

test('pipeline ledger records failed transitions with error codes', () => {
  let ledger = createPipelineRunLedger(baseContext.projectId, baseContext.sessionId, '2026-05-11T11:00:00.000Z');

  ledger = applyPipelineLedgerEvent(ledger, {
    type: 'step:started',
    sessionId: baseContext.sessionId,
    stepId: 'qa',
    stepName: 'QA',
    agent: 'qa',
    description: 'Review',
    stepIndex: 2,
    totalSteps: 4,
  }, { ...baseContext, phase: 'qa-gate', now: '2026-05-11T11:00:01.000Z' });

  ledger = applyPipelineLedgerEvent(ledger, {
    type: 'step:failed',
    sessionId: baseContext.sessionId,
    stepId: 'qa',
    agent: 'qa',
    error: 'Validation failed',
    critical: true,
    errorCode: 'EXECUTION_ERROR',
  }, { ...baseContext, phase: 'qa-gate', now: '2026-05-11T11:00:05.000Z' });

  const record = ledger.records[0];
  assert.equal(record.status, 'failed');
  assert.equal(record.errorCode, 'EXECUTION_ERROR');
  assert.equal(record.errorMessage, 'Validation failed');
  assert.equal(record.durationMs, 4000);
});

test('pipeline ledger creates records for skipped steps', () => {
  const ledger = applyPipelineLedgerEvent(undefined, {
    type: 'step:skipped',
    sessionId: baseContext.sessionId,
    stepId: 'polish',
    agent: 'polish',
    reason: 'Seeded from existing project state',
  } as PipelineEvent, { ...baseContext, now: '2026-05-11T12:00:00.000Z' });

  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].status, 'skipped');
  assert.equal(ledger.records[0].attempt, 0);
  assert.equal(ledger.records[0].errorMessage, 'Seeded from existing project state');
});
