import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTerminalStateConsistency } from './terminal-state-consistency.js';

test('failed terminal session repairs generating project to failed with explicit reason', () => {
  const decision = evaluateTerminalStateConsistency({
    project: {
      id: 'p1',
      sessionId: 's1',
      status: 'generating',
      projectStatus: 'generating',
      files: [],
    },
    session: {
      sessionId: 's1',
      status: 'failed',
      progress: 0.8,
      executionPhase: 'timed_out',
      providerStatus: {},
      retryAttempt: 1,
      activeWorker: null,
      lastHeartbeatAt: new Date().toISOString(),
      timeoutAt: null,
      timeoutRemainingMs: null,
      failureReason: null,
      steps: [],
      completedAgents: [],
      failedAgents: [],
      events: [],
      startedAt: new Date(),
      durationMs: 1000,
    },
  });

  assert.equal(decision.shouldRepair, true);
  assert.equal(decision.expectedStatus, 'failed');
  assert.match(decision.failureReason ?? '', /timed out/i);
});

test('completed terminal session repairs generating project to generated', () => {
  const decision = evaluateTerminalStateConsistency({
    project: {
      id: 'p2',
      sessionId: 's2',
      status: 'generating',
      projectStatus: 'generating',
      files: [{ path: 'src/app/page.tsx', content: 'export default function Page(){return null;}\n' }],
    },
    session: {
      sessionId: 's2',
      status: 'completed',
      progress: 1,
      executionPhase: 'completed',
      providerStatus: {},
      retryAttempt: 0,
      activeWorker: null,
      lastHeartbeatAt: new Date().toISOString(),
      timeoutAt: null,
      timeoutRemainingMs: null,
      failureReason: null,
      steps: [],
      completedAgents: [],
      failedAgents: [],
      events: [],
      startedAt: new Date(),
      durationMs: 1000,
    },
  });

  assert.equal(decision.shouldRepair, true);
  assert.equal(decision.expectedStatus, 'generated');
  assert.equal(decision.failureReason, null);
});

test('does not demote generated project to failed on terminal session failure', () => {
  const decision = evaluateTerminalStateConsistency({
    project: {
      id: 'p3',
      sessionId: 's3',
      status: 'generated',
      projectStatus: 'generated',
      files: [{ path: 'src/app/page.tsx', content: 'export default function Page(){return null;}\n' }],
      error: undefined,
      failure: {},
    },
    session: {
      sessionId: 's3',
      status: 'failed',
      progress: 1,
      executionPhase: 'failed',
      providerStatus: {},
      retryAttempt: 0,
      activeWorker: null,
      lastHeartbeatAt: new Date().toISOString(),
      timeoutAt: null,
      timeoutRemainingMs: null,
      failureReason: 'install exited with code 1',
      steps: [],
      completedAgents: [],
      failedAgents: [],
      events: [],
      startedAt: new Date(),
      durationMs: 1000,
    },
  });

  assert.equal(decision.shouldRepair, false);
  assert.equal(decision.expectedStatus, 'failed');
});
