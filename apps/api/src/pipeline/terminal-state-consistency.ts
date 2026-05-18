import type { SessionProgress } from './session-manager.js';

type TerminalExpectation = 'generated' | 'failed';

export interface TerminalConsistencyEvent {
  capturedAt: string;
  sessionId: string;
  projectId: string;
  sessionStatus: SessionProgress['status'];
  sessionExecutionPhase: SessionProgress['executionPhase'];
  expectedProjectStatus: TerminalExpectation;
  previousProjectStatus: 'generating' | 'generated' | 'failed';
  repaired: boolean;
  reason: string;
}

export interface TerminalConsistencyDecision {
  shouldRepair: boolean;
  expectedStatus: TerminalExpectation | null;
  failureReason: string | null;
  event: TerminalConsistencyEvent | null;
}

export interface TerminalProjectLike {
  id: string;
  sessionId: string;
  status: 'generating' | 'generated' | 'failed';
  projectStatus?: 'generating' | 'generated' | 'failed';
  files?: Array<{ path: string; content?: string }>;
  error?: string;
  failure?: {
    failureReason?: string;
    errorMessage?: string;
  };
}

function isTerminalSession(session: SessionProgress): boolean {
  return session.status === 'completed' || session.status === 'failed';
}

function expectedStatusFor(session: SessionProgress): TerminalExpectation | null {
  if (session.status === 'completed') return 'generated';
  if (session.status === 'failed') return 'failed';
  return null;
}

function failureReasonFrom(session: SessionProgress): string {
  const base = session.failureReason?.trim();
  if (base && base.length > 0) return base;
  if (session.executionPhase === 'timed_out') return 'mission timed out before terminal project state was persisted';
  if (session.executionPhase === 'provider_unavailable') return 'provider unavailable before terminal project state was persisted';
  return `session terminal failure in executionPhase=${session.executionPhase}`;
}

export function evaluateTerminalStateConsistency(input: {
  project: TerminalProjectLike;
  session: SessionProgress;
  capturedAt?: string;
}): TerminalConsistencyDecision {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const { project, session } = input;
  if (!isTerminalSession(session)) {
    return { shouldRepair: false, expectedStatus: null, failureReason: null, event: null };
  }

  const expected = expectedStatusFor(session);
  if (!expected) {
    return { shouldRepair: false, expectedStatus: null, failureReason: null, event: null };
  }

  const projectStatus = project.projectStatus ?? project.status;
  // Do not demote already-generated projects based on late terminal-session
  // failures from post-generation validators/watchdogs.
  if (projectStatus === 'generated' && expected === 'failed') {
    return {
      shouldRepair: false,
      expectedStatus: expected,
      failureReason: null,
      event: {
        capturedAt,
        sessionId: session.sessionId,
        projectId: project.id,
        sessionStatus: session.status,
        sessionExecutionPhase: session.executionPhase,
        expectedProjectStatus: expected,
        previousProjectStatus: projectStatus,
        repaired: false,
        reason: 'generated projects are immutable for terminal-consistency demotion',
      },
    };
  }
  const alreadyConsistent = projectStatus === expected;
  const missingFailureReason = expected === 'failed'
    && !(project.failure?.failureReason || project.failure?.errorMessage || project.error);
  const shouldRepair = !alreadyConsistent || missingFailureReason;
  const failureReason = expected === 'failed' ? failureReasonFrom(session) : null;

  return {
    shouldRepair,
    expectedStatus: expected,
    failureReason,
    event: {
      capturedAt,
      sessionId: session.sessionId,
      projectId: project.id,
      sessionStatus: session.status,
      sessionExecutionPhase: session.executionPhase,
      expectedProjectStatus: expected,
      previousProjectStatus: projectStatus,
      repaired: shouldRepair,
      reason: shouldRepair
        ? `terminal-state invariant repaired: expected project.status=${expected}`
        : 'terminal-state invariant already satisfied',
    },
  };
}
