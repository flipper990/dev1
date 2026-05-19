# Targeted Test Results

## Commands run
1. `npx tsx --test apps/api/src/pipeline/ui-foundation.test.ts`
2. `npx tsx --test apps/api/src/pipeline/deterministic-generation-contract.test.ts apps/api/src/pipeline/tier-slice-validator.test.ts apps/api/src/preview/preview-file-validator.test.ts apps/api/src/pipeline/generation-failure-classifier.test.ts apps/api/src/pipeline/prompt-tier-classifier.test.ts apps/api/src/pipeline/orchestration-router.test.ts apps/api/src/testing/preview-manager.observability-persistence.test.ts apps/api/src/testing/preview-scheduler.observability-artifacts.test.ts`
3. `npm run test:contracts:fast --workspace=@devteam/api`
4. `npm run test:package:unit --workspace=@devteam/api`
5. `npm run typecheck --workspace=@devteam/api`
6. `npm run build --workspace=@devteam/api`

## Result
- All targeted tests passed.
- Validator/import-export/foundation/classifier/observability coverage remained green.
- Fast contracts passed.
- Package tests passed.
- API typecheck/build passed.

## New targeted tests added
- `apps/api/src/pipeline/ui-foundation.test.ts`
  - `sanitizeUIFoundation repairs dashboard ActivityItem contract when feed passes activity prop`
- `apps/api/src/pipeline/ui-foundation.test.ts`
  - Updated canonical Alert unchanged fixture to match strict canonical contract requirements.
- (already added in this run chain) `apps/api/src/pipeline/generation-failure-classifier.test.ts`
  - `button anchor prop mismatch during preview build stays generated_typescript_error`
