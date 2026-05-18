import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateQaGateDecision } from './qa-gate-policy.js';
import type { QAReport } from './quality-assurance.js';

function baseReport(): QAReport {
  return {
    passed: false,
    score: 96,
    bars: {
      'ui-modern': { passed: true, score: 100, notes: [] },
      'layout-structure': { passed: true, score: 100, notes: [] },
      'functional-e2e': { passed: false, score: 80, notes: ['warning-like issue'] },
      'preview-renders': { passed: true, score: 100, notes: [] },
      'no-placeholders': { passed: true, score: 100, notes: [] },
    },
    findings: [],
    autoFixCount: 0,
    blockers: [],
  };
}

test('score 96 no blockers passes for Tier 1 policy', () => {
  const decision = evaluateQaGateDecision(baseReport(), {
    tier: 'tier1',
    pipelineCompleted: true,
  });
  assert.equal(decision.passed, true);
});

test('score below threshold fails', () => {
  const report = baseReport();
  report.score = 89;
  const decision = evaluateQaGateDecision(report, {
    tier: 'tier1',
    pipelineCompleted: true,
  });
  assert.equal(decision.passed, false);
  assert.match(decision.reason, /<95/);
});

test('any blocker fails regardless of score', () => {
  const report = baseReport();
  report.score = 99;
  report.blockers = [{ id: 'b1', bar: 'ui-modern', severity: 'blocker', message: 'hard fail' }];
  const decision = evaluateQaGateDecision(report, {
    tier: 'tier1',
    pipelineCompleted: true,
  });
  assert.equal(decision.passed, false);
  assert.match(decision.reason, /blockers=1/);
});

test('warnings do not fail Tier 1 when score passes threshold', () => {
  const report = baseReport();
  report.findings = [{ id: 'w1', bar: 'ui-modern', severity: 'warning', message: 'style warning' }];
  const decision = evaluateQaGateDecision(report, {
    tier: 'tier1',
    pipelineCompleted: true,
  });
  assert.equal(decision.passed, true);
});

test('policy reason is explicit', () => {
  const report = baseReport();
  report.score = 90;
  report.findings = [{ id: 'e1', bar: 'functional-e2e', severity: 'error', message: 'route mismatch' }];
  const decision = evaluateQaGateDecision(report, {
    tier: 'tier1',
    pipelineCompleted: true,
  });
  assert.match(decision.reason, /score 90\/100/);
  assert.match(decision.reason, /errors=1/);
});

