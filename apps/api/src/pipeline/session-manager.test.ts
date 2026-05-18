import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionManager } from './session-manager.js';

function loggerStub() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

test('watchdog marks mission-timeout sessions as terminal failures', () => {
  const manager = new SessionManager(loggerStub() as never);
  const session = manager.create('s-timeout', 'u1', ['prompt']);
  session.createdAt = new Date(Date.now() - 120_000);
  const progress = manager.getProgress('s-timeout');
  assert.ok(progress);
  progress.startedAt = new Date(Date.now() - 120_000);
  manager.markHeartbeat('s-timeout', {
    phase: 'spec',
    step: 'spec:orchestrator-invoke',
  });

  const failures = manager.sweepStalled({
    missionTimeoutMs: 30_000,
    heartbeatTimeoutMs: 300_000,
    stalledStepTimeoutMs: 300_000,
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.reason, 'mission-timeout');

  const updated = manager.getProgress('s-timeout');
  assert.equal(updated?.status, 'failed');
  assert.equal(updated?.executionPhase, 'timed_out');
});

test('watchdog marks stalled-step sessions when step heartbeat is stale', () => {
  const manager = new SessionManager(loggerStub() as never);
  manager.create('s-stall', 'u2', ['prompt']);

  manager.handleEvent({
    type: 'step:started',
    sessionId: 's-stall',
    stepId: 'build',
    stepIndex: 1,
    totalSteps: 4,
    agent: 'builder',
  } as never);

  const progress = manager.getProgress('s-stall');
  assert.ok(progress);
  progress.currentStepStartedAt = new Date(Date.now() - 90_000);
  progress.lastHeartbeatAt = new Date(Date.now() - 90_000).toISOString();

  const failures = manager.sweepStalled({
    missionTimeoutMs: 600_000,
    heartbeatTimeoutMs: 600_000,
    stalledStepTimeoutMs: 20_000,
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.reason, 'stalled-step');

  const updated = manager.getProgress('s-stall');
  assert.equal(updated?.status, 'failed');
  assert.equal(updated?.failureReason?.includes('stalled-step'), true);
});

test('markProviderUnavailable creates terminal progress when reservation failed before session creation', () => {
  const manager = new SessionManager(loggerStub() as never);
  manager.markProviderUnavailable('s-reservation-fail', 'project persistence failed during reservation');

  const progress = manager.getProgress('s-reservation-fail');
  assert.ok(progress);
  assert.equal(progress?.status, 'failed');
  assert.equal(progress?.executionPhase, 'provider_unavailable');
  assert.match(progress?.failureReason ?? '', /project persistence failed/i);
});
