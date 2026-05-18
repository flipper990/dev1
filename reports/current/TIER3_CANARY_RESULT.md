# Tier 3 Canary Result

## Prompt
"Build a fullstack SaaS app with user accounts, projects, dashboard, API routes, and persistent CRUD data model."

## Run result
- status: success
- summary: total=1, succeeded=1, failed=0
- durationMs: 57075
- projectId: `NhWEaAWe5Eq-`
- tier classification: `TIER_3_FULLSTACK` (router-selected Tier 3 contract-first path)

## Contract artifact evidence
- Required contract files generated:
  - `src/contracts/api-contract.ts`
  - `src/contracts/data-model-contract.ts`
  - `src/contracts/route-contract.ts`
  - `src/contracts/boundary-contract.ts`
- Contract files retained through assembly/normalization: yes (validated by Tier 3 runner retention checks and tests)

## Validation and runtime states
- frontend/backend contract validation: pass
- previewState: `ready`
- exportState: `ok`
- failureCategory: none
- failureReason: none