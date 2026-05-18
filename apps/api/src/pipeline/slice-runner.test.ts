import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBuilderProducedFiles } from './slice-runner.js';

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

test('assertBuilderProducedFiles does not throw when orchestrator failed but builder emitted files', () => {
  assert.doesNotThrow(() => {
    assertBuilderProducedFiles(
      {
        status: 'failed',
        error: 'upstream issue',
        artifacts: new Map([
          ['builder', { files: [{ path: 'src/app/page.tsx', content: 'export default function Page(){return null;}\n' }] }],
        ]) as any,
      },
      {
        phase: 'slice-1/3',
        step: 'builder',
        sliceLabel: '1/3',
        sliceId: 'slice-1',
      },
      logger,
    );
  });
});

test('assertBuilderProducedFiles throws when builder has zero files', () => {
  assert.throws(() => {
    assertBuilderProducedFiles(
      {
        status: 'failed',
        error: 'builder returned empty',
        artifacts: new Map([
          ['builder', { files: [] }],
        ]) as any,
      },
      {
        phase: 'slice-1/3',
        step: 'builder',
        sliceLabel: '1/3',
        sliceId: 'slice-1',
      },
      logger,
    );
  }, /builder-empty/i);
});

