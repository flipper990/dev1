import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateMissionTerminalSync } from './mission-terminal-sync.js';

test('returns snapshot immediately when project already reached terminal state', () => {
  const decision = evaluateMissionTerminalSync({
    projectStatus: 'generated',
    sessionStatus: 'completed',
    terminalSessionAgeMs: 0,
  });
  assert.equal(decision.returnSnapshot, true);
  assert.match(decision.reason, /project-terminal:generated/);
});

test('does not return early when session completed but project is still generating', () => {
  const decision = evaluateMissionTerminalSync({
    projectStatus: 'generating',
    sessionStatus: 'completed',
    terminalSessionAgeMs: 60_000,
  });
  assert.equal(decision.returnSnapshot, false);
  assert.match(decision.reason, /awaiting-project-terminal-state/i);
});

test('waits for failed-session grace before returning generating snapshot', () => {
  const early = evaluateMissionTerminalSync({
    projectStatus: 'generating',
    sessionStatus: 'failed',
    terminalSessionAgeMs: 4_000,
    failedSessionGraceMs: 10_000,
  });
  assert.equal(early.returnSnapshot, false);

  const late = evaluateMissionTerminalSync({
    projectStatus: 'generating',
    sessionStatus: 'failed',
    terminalSessionAgeMs: 12_000,
    failedSessionGraceMs: 10_000,
  });
  assert.equal(late.returnSnapshot, true);
});
