import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPreviewValidationArtifacts } from './preview-scheduler.js';
import type { ProjectRecord } from '../storage/project-store.js';

test('buildPreviewValidationArtifacts carries preview observability fields', () => {
  const rec = {
    id: 'project-1',
    sessionId: 'session-1',
    name: 'test',
    prompts: ['test'],
    status: 'generated',
    files: [],
    tasks: [],
    totalTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    createdAt: new Date().toISOString(),
    version: 1,
    versionHistory: [],
    optimization: {
      cacheHit: true,
      cacheKey: 'k',
      pipelineCacheHits: 1,
      pipelineCacheMisses: 0,
      skippedSteps: 1,
      estimatedApiCallsSaved: 1,
    },
    preview: {
      previewStatus: 'failed',
      previewReady: false,
      previewStageDurations: {
        installing: 1234,
        building: 5678,
      },
      installDurationMs: 1234,
      buildDurationMs: 5678,
      serverStartDurationMs: 55,
      healthProbeDurationMs: 66,
      contentHealthDurationMs: 77,
      previewStartupTotalMs: 8899,
      previewFailurePhase: 'preview:building',
      previewFailureReason: 'build failed',
      cacheDecision: 'hit',
      cacheHit: true,
      dependencyHash: 'abc123',
      installSkipped: true,
      installExitCode: 0,
      buildExitCode: 1,
      startCommand: 'npm run build',
      runtimeCwd: '/runtime',
      timeoutSource: 'preview-manager:boot-watchdog',
      timeoutLimit: 150000,
      currentPreviewPhase: 'preview:building',
      elapsedTime: 8899,
      lastPreviewLogLine: 'Type error',
      processState: 'crashed',
    },
    executionValidation: {
      finalVerdict: 'fail',
      iterations: 0,
      buildErrors: [],
      runtimeErrors: [],
      totalDurationMs: 0,
      completedAt: new Date().toISOString(),
      details: {
        steps: [],
      },
    },
    runtimeValidation: {
      finalVerdict: 'fail',
      iterations: 0,
      issues: [],
      totalDurationMs: 0,
      completedAt: new Date().toISOString(),
      details: {},
    },
  } as unknown as ProjectRecord;

  const artifacts = buildPreviewValidationArtifacts(rec, {
    sanitizeSnippet: (input) => input ?? null,
    looksPlaceholderText: () => false,
    hasFrameworkOverlaySignals: () => false,
  }) as Record<string, unknown>;

  assert.equal(artifacts.installDurationMs, 1234);
  assert.equal(artifacts.buildDurationMs, 5678);
  assert.equal(artifacts.previewStartupTotalMs, 8899);
  assert.equal(artifacts.exportDurationMs, null);
  assert.equal(artifacts.previewFailurePhase, 'preview:building');
  assert.equal(artifacts.previewFailureReason, 'build failed');
  assert.equal(artifacts.cacheDecision, 'hit');
  assert.equal(artifacts.cacheHit, true);
  assert.equal(artifacts.installSkipped, true);
  assert.equal(artifacts.installExitCode, 0);
  assert.equal(artifacts.buildExitCode, 1);
  assert.equal(artifacts.startCommand, 'npm run build');
  assert.equal(artifacts.runtimeCwd, '/runtime');
  assert.equal(artifacts.timeoutSource, 'preview-manager:boot-watchdog');
  assert.equal(artifacts.timeoutLimit, 150000);
  assert.equal(artifacts.currentPreviewPhase, 'preview:building');
  assert.equal(artifacts.elapsedTime, 8899);
  assert.equal(artifacts.lastPreviewLogLine, 'Type error');
  assert.equal(artifacts.processState, 'crashed');
});
