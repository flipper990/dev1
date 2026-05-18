# Regression Guard Test Report

## Goal
Lock 6/6 multi-tier milestone behavior and prevent regressions across all tier paths.

## Regression guards now present
- Tier router + classification:
  - `apps/api/src/pipeline/orchestration-router.test.ts`
  - `apps/api/src/pipeline/prompt-tier-classifier.test.ts`
- Tier 1 fast path + scope blocking:
  - `apps/api/src/pipeline/fast-tier1-runner.test.ts`
  - `apps/api/src/pipeline/tier-policy.test.ts`
  - `apps/api/src/pipeline/tier1-scope-policy.test.ts`
- Tier 2 structured path:
  - `apps/api/src/pipeline/tier2-structured-runner.test.ts` (added)
- Tier 3 contract-first + contract retention:
  - `apps/api/src/pipeline/tier3-contract-runner.test.ts`
  - `apps/api/src/pipeline/tier-policy.test.ts`
- Terminal quality status:
  - `apps/api/src/pipeline/terminal-quality.test.ts`

## Added/updated guard assertions in this lock
1. Tier 2 structured runner tests added to guard path behavior and backend/db exclusion.
2. Tier 1 policy test strengthened to explicitly block:
   - `db/**`
   - `tests/**`
   - `src/__tests__/**`
3. Classifier guards expanded for Tier 1 prompt variants:
   - portfolio
   - docs/help
4. Classifier precedence guard added:
   - Tier 3 signals override Tier 1 hints.
5. Terminal quality guard strengthened:
   - `completed_degraded` is explicitly not equal to `completed_full_quality`.

## Result
- All regression guard suites passed in lock run.