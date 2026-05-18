import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveQualityTerminalStatus } from './terminal-quality.js';

test('degraded fallback maps to completed_degraded', () => {
  const status = deriveQualityTerminalStatus({ generated: true, fallbackUsed: true, failureCategory: 'timeout' });
  assert.equal(status, 'completed_degraded');
  assert.notEqual(status, 'completed_full_quality');
});

test('recoverable failure maps to failed_recoverable', () => {
  const status = deriveQualityTerminalStatus({ generated: false, fallbackUsed: false, failureCategory: 'timeout' });
  assert.equal(status, 'failed_recoverable');
});

test('unrecoverable failure maps to failed_unrecoverable', () => {
  const status = deriveQualityTerminalStatus({ generated: false, fallbackUsed: false, failureCategory: 'generated_import_export_mismatch' });
  assert.equal(status, 'failed_unrecoverable');
});

test('tier3 missing contracts does not map to success status', () => {
  const status = deriveQualityTerminalStatus({ generated: false, fallbackUsed: false, failureCategory: 'tier3_contract_missing' });
  assert.equal(status, 'failed_unrecoverable');
});
