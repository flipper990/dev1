# PREVIEW_OBSERVABILITY_FIX_REPORT

Date: 2026-05-19

## Scope
Observability-only changes were added without changing generation logic, routing tiers, auth/DB/provider/proxy/UI, or cache behavior.

## Added persisted fields
The following fields are now persisted to preview diagnostics (`project.preview`) and mirrored into project diagnostics (`diagnostics.previewValidationArtifacts`) and canary results (`successful-mission-results.json`):

- `previewStageDurations`
- `installDurationMs`
- `buildDurationMs`
- `serverStartDurationMs`
- `healthProbeDurationMs`
- `contentHealthDurationMs`
- `exportDurationMs` (project diagnostics/canary; preview value is null)
- `previewStartupTotalMs`
- `previewFailurePhase`
- `previewFailureReason`
- `cacheDecision`
- `cacheHit`
- `dependencyHash`
- `installSkipped`
- `installExitCode`
- `buildExitCode`
- `startCommand`
- `runtimeCwd`

## Timeout visibility fields added
- `timeoutSource`
- `timeoutLimit`
- `currentPreviewPhase`
- `elapsedTime`
- `lastPreviewLogLine`
- `processState`

## Implementation points
- `apps/api/src/preview/preview-manager.ts`
  - Added stage duration aggregation, exit-code parsing, last-log-line extraction
  - Persisted all new observability fields via `syncPreviewToProject`
  - Added timeout/failure visibility fields to timeout/runtime/local failure dumps
- `apps/api/src/pipeline/preview-scheduler.ts`
  - Mirrored observability fields into `diagnostics.previewValidationArtifacts`
- `apps/api/src/testing/successful-mission-e2e.ts`
  - Added canary result persistence for observability fields per mission result
  - Added `exportDurationMs` measurement
- `apps/api/src/storage/project-store.ts`
  - Extended `ProjectRecord.preview` schema for new persisted preview fields
- `apps/api/src/preview/types.ts`
  - Extended `PreviewStatus` shape with observability fields

## Added tests
- `apps/api/src/preview/preview-manager.observability-persistence.test.ts`
- `apps/api/src/pipeline/preview-scheduler.observability-artifacts.test.ts`
