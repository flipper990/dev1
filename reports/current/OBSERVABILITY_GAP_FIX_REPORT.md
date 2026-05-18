# Observability Gap Fix Report

## Requested gaps
- provider call counts not exposed
- numeric repair counts not exposed

## Lightweight fix implemented
Updated `apps/api/src/pipeline/project-generator.ts` to publish the following top-level diagnostics consistently in finalization paths:
- `providerCallCount`
- `repairAttemptCount`
- `slicesGenerated`
- `slicesRejected`
- `slicesRepaired`
- `fastPathUsed`
- `tierClassification`
- `totalRuntimeMs`

## Implementation notes
- No pipeline behavior changes.
- No auth/DB/provider/preview-proxy changes.
- No refactor of runner logic.
- `providerCallCount` is derived safely from existing pipeline ledger and `progress.llmCallCount` fallback.
- `repairAttemptCount` is derived from existing ledger `validationResult.repairCount` aggregation.

## Files changed
- `apps/api/src/pipeline/project-generator.ts`

## Safety
- Pure diagnostics enrichment only.
- Existing generation outcomes unchanged.