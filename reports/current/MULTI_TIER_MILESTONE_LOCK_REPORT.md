# Multi-Tier Milestone Lock Report

## Milestone status
- Multi-tier capped canary: **6/6 passed**
- Tier 1: **3/3 passed**
- Tier 2: **2/2 passed**
- Tier 3: **1/1 passed**
- API gates: **typecheck pass**, **build pass**
- Targeted regression suite: **pass**

## Enabled flags used for lock validation
- `MULTI_TIER_ROUTER=true`
- `FAST_TIER1_PATH=true`
- `FAST_TIER2_PATH=true`
- `TIER3_CONTRACT_FIRST_PATH=true`
- `MULTI_TIER_FALLBACK_TO_LEGACY=false`

## Tier router behavior (locked)
- `TIER_1_FRONTEND_ONLY` -> `tier1-fast`
- `TIER_2_STRUCTURED_APP` -> `tier2-structured`
- `TIER_3_FULLSTACK` -> `tier3-contract-first`
- legacy route remains available when tier path flags are disabled

## Tier 1 policy (locked)
- Fast frontend-only path
- Blocks backend/API/DB/test artifacts from Tier 1 runtime outputs
- Incremental slice validation remains active

## Tier 2 policy (locked)
- Structured app path
- Multi-page/components/state/mock data flow
- Backend/db/migration runtime artifacts remain out of Tier 2 structured outputs

## Tier 3 policy (locked)
- Contract-first path and ordered gates remain required
- Required contracts retained:
  - `src/contracts/api-contract.ts`
  - `src/contracts/data-model-contract.ts`
  - `src/contracts/route-contract.ts`
  - `src/contracts/boundary-contract.ts`
- Missing contracts remain explicit failure condition

## Passing commands
1. `npx tsx --test apps/api/src/pipeline/orchestration-router.test.ts apps/api/src/pipeline/prompt-tier-classifier.test.ts apps/api/src/pipeline/tier-policy.test.ts apps/api/src/pipeline/fast-tier1-runner.test.ts apps/api/src/pipeline/tier2-structured-runner.test.ts apps/api/src/pipeline/tier3-contract-runner.test.ts apps/api/src/pipeline/terminal-quality.test.ts`
2. `npm run test:contracts:fast --workspace=@devteam/api`
3. `npm run test:package:unit --workspace=@devteam/api`
4. `npm run typecheck --workspace=@devteam/api`
5. `npm run build --workspace=@devteam/api`
6. `npm run test:missions:e2e --workspace=@devteam/api` with capped 6 prompts

## Known remaining gaps
- E2E mission summary still labels many prompts as `custom` in tier breakdown output; pass/fail correctness is intact but tier buckets are not fully attributed.
- Preview startup remains dominant runtime cost phase in canary runs.