# PROMPT_CLASSIFIER_REPORT

Date: 2026-05-18
Module: `apps/api/src/pipeline/prompt-tier-classifier.ts`

## Classification model
- `TIER_1_FRONTEND_ONLY`
- `TIER_2_STRUCTURED_APP`
- `TIER_3_FULLSTACK`

Priority order:
1. Tier3 signals (auth/db/api/backend/payments/integrations/persistence) -> Tier3
2. Tier1 signals present and Tier2 absent -> Tier1
3. Tier2 signals present -> Tier2
4. Conservative fallback -> Tier1

## Required classifier checks
Validated by `apps/api/src/pipeline/prompt-tier-classifier.test.ts`:
- landing page -> Tier1
- pricing page -> Tier1
- waitlist -> Tier1
- dashboard with mock data -> Tier1
- auth/database/API prompt -> Tier3

## Test status
Pass (see `FAST_PATH_TEST_RESULTS.md`).
