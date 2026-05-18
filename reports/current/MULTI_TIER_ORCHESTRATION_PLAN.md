# MULTI_TIER_ORCHESTRATION_PLAN

Date: 2026-05-18

## Objective
Introduce a universal tier router and tier-specific generation paths while preserving the working Tier1 fast path.

## Implemented routing model
- Tier1 (`TIER_1_FRONTEND_ONLY`) -> `tier1-fast`
- Tier2 (`TIER_2_STRUCTURED_APP`) -> `tier2-structured`
- Tier3 (`TIER_3_FULLSTACK`) -> `tier3-contract-first`
- Fallback route -> `legacy`

## Runtime safety
- Tier1 behavior preserved behind `FAST_TIER1_PATH`.
- Router and tier paths are config-gated:
  - `MULTI_TIER_ROUTER`
  - `FAST_TIER2_PATH`
  - `TIER3_CONTRACT_FIRST_PATH`
  - `MULTI_TIER_FALLBACK_TO_LEGACY`
- Tier-specific budgets added:
  - `TIER1_TIMEOUT_MS`, `TIER2_TIMEOUT_MS`, `TIER3_TIMEOUT_MS`
  - `TIER1_RETRY_BUDGET`, `TIER2_RETRY_BUDGET`, `TIER3_RETRY_BUDGET`

## Tier policies
- Tier1: frontend-only deterministic fast path, backend/test blocked.
- Tier2: structured frontend app path with routes/components/state/forms/mock-data; backend/db/migrations still blocked.
- Tier3: fullstack contract-first path with required API/data/route/boundary contracts.

## Validation while building
All new tier paths validate slices before merge:
- path scope
- content non-empty
- TS/TSX parse
- CSS syntax
- unresolved imports
- missing named exports

## Quality terminal classes
Added quality terminal status mapping:
- `completed_full_quality`
- `completed_degraded`
- `failed_recoverable`
- `failed_unrecoverable`
