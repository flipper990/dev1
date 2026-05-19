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

test('syncPreviewToProject persists preview observability and timeout fields', async () => {
  let capturedPatch: any = null;
  const manager = new PreviewManager({
    projectStore: {
      updatePreview: async (_projectId: string, patch: Record<string, unknown>) => {
        capturedPatch = patch;
        return {
          ok: true,
          prevPreviewStatus: 'starting',
          nextPreviewStatus: 'failed',
          stateVersion: 7,
        };
      },
    } as any,
    docker: {} as any,
    ports: { release: () => {} } as any,
    logger: noopLogger as any,
    localRunner: {
      get: () => ({
        stagingDir: '/tmp/runtime',
        lastSuccessfulStep: 'install cache hit',
        error: 'build failed: npm run build exited code=1',
        stdoutLog: '',
        stderrLog: 'Type error: X',
      }),
    } as any,
  });

  const now = new Date();
  const startedAtIso = new Date(now.getTime() - 12_000).toISOString();
  const timeoutAtIso = new Date(now.getTime() - 2_000).toISOString();
  const record: PreviewRecord = {
    projectId: 'p1',
    previewId: 'pv1',
    state: 'failed',
    stack: null,
    imageTag: null,
    containerId: null,
    hostPort: 3111,
    startedAt: now.getTime() - 12_000,
    lastAccessedAt: now.getTime() - 3_000,
    error: 'build failed: npm run build exited code=1',
    log: 'line 1\nline 2',
    mode: 'local',
    runtime: {
      type: 'local',
      cmd: 'npm.cmd',
      args: ['run', 'build'],
      cwd: '/tmp/runtime',
    },
    startedAtIso,
    timeoutAtIso,
    timeoutDurationMs: 150_000,
    timeoutCause: 'build-hung',
    timeoutLifecycle: {
      installStarted: true,
      installCompleted: true,
      buildStarted: true,
      buildCompleted: false,
      serverSpawned: false,
      portOpened: false,
      firstProbeAttempted: false,
    },
    runtimeLog: {
      pid: 1234,
      cmd: 'npm.cmd run build',
      cwd: '/tmp/runtime',
      port: 3111,
      stdoutTail: 'stdout line',
      stderrTail: 'stderr one\nstderr two',
      capturedAt: now.toISOString(),
    },
    processLifecycle: {
      startedAt: startedAtIso,
      exitedAt: null,
      exitCode: null,
      signal: null,
      alive: true,
      pid: 1234,
      uptimeMs: 10_000,
      classification: 'alive-hanging',
      capturedAt: now.toISOString(),
    },
    step: 'preview:building',
    stepStartedAt: startedAtIso,
    stepCompletedAt: null,
    stepDurations: [
      {
        step: 'preview:installing',
        startedAt: startedAtIso,
        completedAt: new Date(now.getTime() - 7_000).toISOString(),
        durationMs: 5_000,
      },
      {
        step: 'preview:building',
        startedAt: new Date(now.getTime() - 7_000).toISOString(),
        completedAt: timeoutAtIso,
        durationMs: 5_000,
      },
    ],
  };

  await (manager as any).syncPreviewToProject(record);

  assert.ok(capturedPatch, 'expected updatePreview patch to be captured');
  assert.equal(capturedPatch.installDurationMs, 5_000);
  assert.equal(capturedPatch.buildDurationMs, 5_000);
  assert.equal(capturedPatch.cacheHit, true);
  assert.equal(capturedPatch.installSkipped, true);
  assert.equal(capturedPatch.buildExitCode, 1);
  assert.equal(capturedPatch.startCommand, 'npm.cmd run build');
  assert.equal(capturedPatch.runtimeCwd, '/tmp/runtime');
  assert.equal(capturedPatch.timeoutSource, 'preview-manager:boot-watchdog');
  assert.equal(capturedPatch.timeoutLimit, 150000);
  assert.equal(capturedPatch.currentPreviewPhase, 'preview:building');
  assert.equal(capturedPatch.processState, 'alive-hanging');
  assert.equal(capturedPatch.lastPreviewLogLine, 'stderr two');
});
