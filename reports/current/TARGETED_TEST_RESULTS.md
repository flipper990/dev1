# Targeted Test Results

## Commands and outcomes
1. `npx tsx --test apps/api/src/pipeline/ui-foundation.test.ts apps/api/src/pipeline/generation-failure-classifier.test.ts apps/api/src/pipeline/deterministic-generation-contract.test.ts apps/api/src/pipeline/import-repair.test.ts`
- Result: PASS (45/45)

2. `npx tsx --test apps/api/src/preview/local-runner.failure-snapshot.test.ts apps/api/src/preview/preview-manager.fail-classification.test.ts`
- Result: PASS (4/4)

3. `npm run test:contracts:fast --workspace=@devteam/api`
- Result: PASS

4. `npm run test:package:unit --workspace=@devteam/api`
- Result: PASS (6/6)

5. `npm run typecheck --workspace=@devteam/api`
- Result: PASS

6. `npm run build --workspace=@devteam/api`
- Result: PASS

## Notes
- One classifier test initially failed and was fixed by tightening TS error matching; rerun was fully green.
