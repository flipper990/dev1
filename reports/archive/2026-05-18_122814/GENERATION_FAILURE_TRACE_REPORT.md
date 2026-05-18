# GENERATION_FAILURE_TRACE_REPORT

## Compact trace persistence
Generation failure trace remains persisted in project diagnostics (`diagnostics.generationFailureTrace`) and is now enriched.

## Added/ensured trace contents
- Top-level failure metadata:
  - `failureCategory`, `failurePhase`, `failureReason`, `failedAgent`, `failedStep`
  - `retryCount`, `lastValidCheckpoint`, `filesGeneratedBeforeFailure`, `recoveryAttempted`
  - `recommendedNextAction`, `zeroFileClassification`
- Phase timeline entries now include:
  - `phase`, `stepId`, `agentRole`, `status`, `retryCount`
  - `attempt`, `startedAt`, `completedAt`, `durationMs`
  - `model`, `provider`, `errorCode`, `errorMessage`
- Validation decisions now include:
  - `validationVerdict`, `validationIssueCount`, `validationRepairCount`
- Checkpoint trail (compact recent window):
  - checkpoint ids/phase/step/status/time/fileCount/slice coords
- File/fallback summary:
  - `filesAccepted`, `filesRejected`, `fallbackAttempts`

## Result
Failed missions now preserve an actionable phase-by-phase trace suitable for postmortem and retry guidance, instead of generic failure surfaces.
