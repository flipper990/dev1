# TARGETED_TEST_RESULTS

Date: 2026-05-18

## Commands Run

1. `npx tsx --test apps/api/src/pipeline/orchestration-router.test.ts apps/api/src/pipeline/prompt-tier-classifier.test.ts apps/api/src/pipeline/tier-policy.test.ts apps/api/src/pipeline/fast-tier1-runner.test.ts apps/api/src/pipeline/tier2-structured-runner.test.ts apps/api/src/pipeline/tier3-contract-runner.test.ts apps/api/src/pipeline/terminal-quality.test.ts`
- Result: pass (34/34)

2. `npm run test:contracts:fast --workspace=@devteam/api`
- Result: pass

3. `npm run test:package:unit --workspace=@devteam/api`
- Result: pass

4. `npm run typecheck --workspace=@devteam/api`
- Result: pass

5. `npm run build --workspace=@devteam/api`
- Result: pass

Overall: all targeted regression gates passed.
