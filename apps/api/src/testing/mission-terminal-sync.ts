export interface MissionTerminalSyncDecisionInput {
  projectStatus: string | null;
  sessionStatus: string | null;
  terminalSessionAgeMs: number;
  failedSessionGraceMs?: number;
}

export interface MissionTerminalSyncDecision {
  returnSnapshot: boolean;
  reason: string;
}

const DEFAULT_FAILED_SESSION_GRACE_MS = 12_000;

export function evaluateMissionTerminalSync(
  input: MissionTerminalSyncDecisionInput,
): MissionTerminalSyncDecision {
  const projectStatus = String(input.projectStatus ?? '').toLowerCase();
  if (projectStatus.length > 0 && projectStatus !== 'generating') {
    return {
      returnSnapshot: true,
      reason: `project-terminal:${projectStatus}`,
    };
  }

  const sessionStatus = String(input.sessionStatus ?? '').toLowerCase();
  if (sessionStatus === 'completed') {
    return {
      returnSnapshot: false,
      reason: 'session-completed-awaiting-project-terminal-state',
    };
  }

  if (sessionStatus === 'failed') {
    const graceMs = Number.isFinite(input.failedSessionGraceMs)
      ? Number(input.failedSessionGraceMs)
      : DEFAULT_FAILED_SESSION_GRACE_MS;
    if (input.terminalSessionAgeMs >= graceMs) {
      return {
        returnSnapshot: true,
        reason: `session-failed-grace-elapsed:${graceMs}ms`,
      };
    }
    return {
      returnSnapshot: false,
      reason: `session-failed-grace-pending:${graceMs}ms`,
    };
  }

  return {
    returnSnapshot: false,
    reason: 'session-non-terminal',
  };
}
