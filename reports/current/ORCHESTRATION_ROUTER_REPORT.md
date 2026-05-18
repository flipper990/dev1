# ORCHESTRATION_ROUTER_REPORT

Date: 2026-05-18

## Code changes
- Router module: `apps/api/src/pipeline/orchestration-router.ts`
- ProjectGenerator wiring: `apps/api/src/pipeline/project-generator.ts`
- Config flags/budgets: `apps/api/src/config.ts`

## Routing decisions
Router returns per-tier orchestration decision with:
- generation path
- allowed file policy
- required workers
- validation depth
- preview strategy
- export strategy
- QA policy
- timeout/retry budgets

## Current branch behavior in generator
- Tier1 route invokes existing `runFastTier1Pipeline` (preserved behavior)
- Tier2 route invokes `runTier2StructuredPipeline`
- Tier3 route invokes `runTier3ContractPipeline`
- Optional fallback to legacy when configured

## Router tests
Validated in `apps/api/src/pipeline/orchestration-router.test.ts`:
- landing -> Tier1 fast
- pricing -> Tier1 fast
- CRUD -> Tier2 structured
- admin dashboard with forms/state -> Tier2 structured
- auth/database/API -> Tier3 contract-first
