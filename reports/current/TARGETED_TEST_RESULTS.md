# TARGETED_TEST_RESULTS

Date: 2026-05-19

## Commands and outcomes
1. `npm --workspace=@devteam/api exec -- tsx --test src/preview/local-runner.env.test.ts src/preview/local-runner.failure-snapshot.test.ts`
- PASS (7/7)

2. `npm --workspace=@devteam/api exec -- tsx --test src/preview/preview-manager.fail-classification.test.ts src/preview/preview-manager.observability-persistence.test.ts`
- PASS (2/2)

3. `npm --workspace=@devteam/api exec -- tsx --test src/pipeline/generation-failure-classifier.test.ts src/testing/mission-failure-diagnostics.test.ts src/pipeline/failure-diagnostics.test.ts src/pipeline/preview-scheduler.observability-artifacts.test.ts`
- PASS (29/29)

4. `npm run test:contracts:fast --workspace=@devteam/api`
- PASS

5. `npm run test:package:unit --workspace=@devteam/api`
- PASS (6/6)

6. `npm run typecheck --workspace=@devteam/api`
- PASS

7. `npm run build --workspace=@devteam/api`
- PASS

## Notes
A typecheck issue in a newly added test was fixed (`capturedPatch` typing) and typecheck/build then passed.
