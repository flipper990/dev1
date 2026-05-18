# DIAGNOSTICS_FIX_REPORT

## Files changed
- `apps/api/src/testing/mission-failure-diagnostics.ts`
- `apps/api/src/testing/mission-failure-diagnostics.test.ts`
- `apps/api/src/testing/successful-mission-e2e.ts`
- `apps/api/src/testing/generation-runner.ts`
- `apps/api/src/pipeline/failure-diagnostics.ts`
- `apps/api/src/pipeline/failure-diagnostics.test.ts`
- `apps/api/src/storage/project-store.ts`
- `apps/api/src/pipeline/project-generator.ts`
- `apps/api/src/pipeline/project-updater.ts`
- `apps/api/src/llm/smart-router.ts`

## What was fixed
1. Eliminated unknown-style fallback messaging in key failure formatters.
2. Upgraded mission diagnostics extraction to prefer persisted structured trace/failure fields.
3. Prevented artifact-listing transport errors from being misreported as `filesCount=0`.
4. Enriched compact generation failure trace with timeline, validation, checkpoint, and fallback summary detail.
5. Preserved explicit failure category/phase/reason/agent/step/retries/checkpoint/file counters/recovery/action in mission outputs.

## Targeted tests added/updated
- `mission-failure-diagnostics.test.ts`
  - trace fallback when failure block is sparse
  - artifact-listing error is not coerced to zero-file classification
- `failure-diagnostics.test.ts`
  - verifies enriched trace fields (validation/checkpoints)

## Tests run
- `npm run test:package:unit --workspace=@devteam/api` ✅
- `npx --yes tsx --test apps/api/src/testing/mission-failure-diagnostics.test.ts` ✅
- `npx --yes tsx --test apps/api/src/pipeline/failure-diagnostics.test.ts` ✅
- `npx --yes tsx --test apps/api/src/pipeline/generation-failure-classifier.test.ts` ✅

## Notes
Full `typecheck` currently reports unrelated existing compile issues in preview/runtime files (`local-runner.ts`, `preview-manager.ts`) plus pre-existing updater nullability typing; those were outside this upstream-generation-only scope.
