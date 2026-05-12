export function formatFailureSummary(input: {
  failedPhase: string;
  failedStep: string;
  errorName: string;
  errorMessage: string;
}): string {
  return `[phase=${input.failedPhase} step=${input.failedStep}] ${input.errorName}: ${input.errorMessage}`;
}

