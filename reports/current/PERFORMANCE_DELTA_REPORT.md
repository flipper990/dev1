# PERFORMANCE_DELTA_REPORT

Date: 2026-05-18

## Tier1 baseline vs current
- Previous Tier1 fast canary average (from existing reports): ~58-61s
- Current 3 Tier1 prompts in multi-tier canary:
  - 69.7s, 60.8s, 59.4s
- Tier1 remains in the same runtime band; no material regression observed.

## Tier2 observed runtime
- CRUD UI: 60.6s
- Admin dashboard UI: 62.1s
- Tier2 structured path currently runs in ~1 minute range in this environment.

## Tier3 observed runtime
- Fullstack prompt failed fast in 3.5s due contract-first required-contract violation.
- This is desirable fail-fast behavior vs long hidden retries, but Tier3 completion path is not yet production-ready.

## Dominant cost center
- Preview startup remains the dominant runtime phase for successful prompts.

## Overall multi-tier canary
- 5/6 success
- No retries observed
- One Tier3 contract-first blocker
