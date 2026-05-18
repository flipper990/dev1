import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMissionFailureDiagnostics } from './mission-failure-diagnostics.js';

test('unknown failure is never emitted for failed missions with missing error', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'failed',
      progress: { phase: 'qa-gate', lastMeaningfulStep: 'qa-gate:runQualityAssurance' },
      files: [{ path: 'src/app/page.tsx' }],
    },
    sessionProgress: { retryAttempt: 1, executionPhase: 'qa-gate' },
    filesCount: 1,
  });
  assert.notEqual(diagnostics.failureReason.toLowerCase(), 'unknown');
  assert.notEqual(diagnostics.failureCategory.toLowerCase(), 'unknown');
  assert.equal(diagnostics.failurePhase, 'qa-gate');
  assert.equal(diagnostics.failedStep, 'qa-gate:runQualityAssurance');
});

test('zero-file failure is explicitly classified from builder-empty signals', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'failed',
      failure: { failedPhase: 'slice-2/6', failedStep: 'builder', errorMessage: 'builder produced no files' },
      diagnostics: {
        pipelineLedger: {
          records: [{ status: 'failed', errorCode: 'BUILDER_EMPTY_AFTER_FALLBACK', errorMessage: 'builder produced no files' }],
        },
      },
      files: [],
    },
    sessionProgress: { retryAttempt: 0 },
    filesCount: 0,
  });
  assert.equal(diagnostics.zeroFileClassification, 'builder_empty_output');
  assert.equal(diagnostics.filesGeneratedBeforeFailure, 0);
  assert.ok(diagnostics.recommendedNextAction.length > 0);
});

test('contract rejection signals include rejected-file cause in diagnostics', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'failed',
      failure: {
        failedPhase: 'final-integrity-gate',
        failedStep: 'final-integrity-gate:verdict-fail',
        errorMessage: 'Deterministic generation contract FAILED: dangling internal import',
      },
      files: [],
    },
    sessionProgress: { retryAttempt: 2 },
    filesCount: 0,
  });
  assert.equal(diagnostics.zeroFileClassification, 'contract_rejected_all_files');
  assert.equal(diagnostics.retryCount, 2);
  assert.match(diagnostics.recommendedNextAction, /contract/i);
});

test('uses persisted generationFailureTrace when failure block is sparse', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'failed',
      diagnostics: {
        generationFailureTrace: {
          failureCategory: 'empty_generation',
          failurePhase: 'slice-1/2',
          failureReason: 'builder produced no files',
          failedAgent: 'builder',
          failedStep: 'builder:attempt-2',
          retryCount: 1,
          lastValidCheckpoint: 'abc123',
          filesGeneratedBeforeFailure: 0,
          recoveryAttempted: true,
          recommendedNextAction: 'Inspect builder logs.',
        },
      },
    },
    sessionProgress: null,
    filesCount: -1,
  });
  assert.equal(diagnostics.failureCategory, 'empty_generation');
  assert.equal(diagnostics.failedAgent, 'builder');
  assert.equal(diagnostics.lastValidCheckpoint, 'abc123');
  assert.equal(diagnostics.recoveryAttempted, true);
  assert.equal(diagnostics.zeroFileClassification, 'builder_empty_output');
});

test('does not coerce artifact-listing errors into zero-file classification', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'failed',
      failure: {
        failedPhase: 'finalize',
        failedStep: 'finalize:install',
        errorMessage: 'install exited with code 1',
      },
    },
    sessionProgress: null,
    filesCount: -1,
  });
  assert.equal(diagnostics.zeroFileClassification, null);
});

test('extracts explicit terminal-state reason when session failed but project stayed generating', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'generating',
      failure: {},
    },
    sessionProgress: {
      status: 'failed',
      executionPhase: 'timed_out',
      failureReason: 'watchdog=mission-timeout; currentStep=slice-6/8',
    },
    filesCount: 0,
  });
  assert.match(diagnostics.failureReason, /terminal session failed while project remained generating/i);
  assert.equal(diagnostics.failurePhase, 'timed_out');
});

test('extracts explicit terminal-state reason when session completed but project stayed generating', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'generating',
      failure: {},
    },
    sessionProgress: {
      status: 'completed',
      executionPhase: 'completed',
      failureReason: null,
    },
    filesCount: 12,
  });
  assert.match(diagnostics.failureReason, /terminal session completed while project remained generating/i);
  assert.equal(diagnostics.failurePhase, 'completed');
});

test('orchestration failure keeps explicit phase and reason from persisted failure block', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'failed',
      failure: {
        failureCategory: 'orchestration_failure',
        failurePhase: 'finalize',
        failureReason: 'ENOENT while saving output/src/app/articles/:slug',
        failedStep: 'finalize:projectStore.save',
      },
    },
    sessionProgress: null,
    filesCount: 52,
  });
  assert.equal(diagnostics.failureCategory, 'orchestration_failure');
  assert.equal(diagnostics.failurePhase, 'finalize');
  assert.match(diagnostics.failureReason, /ENOENT/);
  assert.equal(diagnostics.failedStep, 'finalize:projectStore.save');
});

test('preview build failure reason is preferred over execution validation install warning', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'generated',
      progress: { phase: 'finalize', lastMeaningfulStep: 'finalize:done' },
      preview: {
        previewError: 'Local preview failed: build failed: npm run build exited code=1; no-document-import-in-page',
      },
      executionValidation: {
        reason: 'install exited with code 1',
      },
    },
    sessionProgress: { retryAttempt: 0, executionPhase: 'finalize' },
    filesCount: 12,
  });
  assert.match(diagnostics.failureReason, /build failed/i);
  assert.equal(diagnostics.failureCategory, 'generated_app_build_failure');
});

test('terminal mismatch with EPERM persistence message is classified as filesystem permission failure', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'generating',
      failure: {},
    },
    sessionProgress: {
      status: 'failed',
      executionPhase: 'queued',
      failureReason: "EPERM: operation not permitted, mkdir 'data/projects/run-123'",
    },
    filesCount: 0,
  });
  assert.equal(diagnostics.failureCategory, 'filesystem_permission_failure');
  assert.match(diagnostics.failureReason, /terminal session failed while project remained generating/i);
});

test('project persistence failure is not downgraded to timeout classification', () => {
  const diagnostics = extractMissionFailureDiagnostics({
    project: {
      status: 'failed',
      failure: {
        failedPhase: 'pipeline',
        failedStep: 'queued',
        errorMessage: 'mission timeout after 420000ms; project persistence failed: project.json missing',
      },
    },
    sessionProgress: null,
    filesCount: 0,
  });
  assert.equal(diagnostics.failureCategory, 'project_persistence_failure');
});
