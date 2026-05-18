# INCREMENTAL_VALIDATION_ALL_TIERS_REPORT

Date: 2026-05-18

## Scope
Validation now runs during generation for Tier1/Tier2/Tier3 slices (not only at final build).

## Validation rules
Per slice:
- path allowed by tier policy
- content non-empty
- TS/TSX parse
- CSS syntax
- unresolved import detection
- missing named export detection

## Tier-specific policy checks
- Tier1: frontend-only runtime scope
- Tier2: structured frontend scope (backend/db blocked)
- Tier3: fullstack scope + required contracts + frontend/backend contract check

## Tests
- `tier-slice-validator.test.ts` (named export + import failures caught early)
- `tier-policy.test.ts` (Tier1/Tier2/Tier3 policy assertions)
- `tier3-contract-runner.test.ts` (contract mismatch caught before final build)
