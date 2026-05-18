import assert from 'node:assert/strict';
import test from 'node:test';

import { PreviewManager } from './preview-manager.js';
import type { PreviewRecord } from './types.js';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as const;

function makeRecord(projectId: string): PreviewRecord {
  const now = new Date().toISOString();
  const ts = Date.now();
  return {
    projectId,
    previewId: 'preview-test-id',
    state: 'starting',
    stack: null,
    imageTag: null,
    containerId: null,
    hostPort: null,
    startedAt: ts,
    lastAccessedAt: ts,
    error: null,
    log: '',
    mode: 'local',
    runtime: { type: 'local' },
    startedAtIso: now,
    readyAtIso: null,
    lastMeaningfulStep: 'spawned dev process',
    history: [{ step: 'preview:queued', at: now }],
    step: 'preview:waiting-for-port',
    stepStartedAt: now,
    stepCompletedAt: null,
    stepDurations: [],
  };
}

test('fail() classifies non-zero exit as crashed when no live local-runner record exists', async () => {
  const manager = new PreviewManager({
    projectStore: {
      updatePreview: async () => ({
        ok: true,
        prevPreviewStatus: null,
        nextPreviewStatus: 'failed',
        stateVersion: 1,
      }),
    } as any,
    docker: {} as any,
    ports: {
      release: () => {},
    } as any,
    logger: noopLogger as any,
    localRunner: {
      get: () => null,
    } as any,
  });

  (manager as any).dumpRuntimeFailure = async () => {};

  const record = makeRecord('preview-fail-crash-classification');
  const status = await (manager as any).fail(record, {
    reason: 'dev server exited',
    exitCode: 1,
    signal: null,
    stderrTail: 'boom',
  });

  assert.equal(status.state, 'failed');
  assert.equal(record.exitInfo?.exitCode, 1);
  assert.equal(record.processLifecycle?.classification, 'crashed');
});
