# Tier 3 Contract Retention Fix Report

## Scope
Tier 3 only. No Tier 1 fast-path or Tier 2 structured-path behavior was changed.

## Implementation changes
- Fixed TypeScript slice parsing in `apps/api/src/pipeline/tier-slice-validator.ts`:
  - no invalid `jsx: undefined` compiler option for `.ts`.
- Strengthened Tier 3 contract-first gates in `apps/api/src/pipeline/tier3-contract-runner.ts`:
  - enforce order: product spec -> architecture -> contract artifacts -> FE/BE/DB/integration.
  - added explicit `contract_validating` phase.
  - added `Tier3ContractMissingError` with code-like message prefix `tier3_contract_missing`.
  - enforce post-assembly retention check for required `src/contracts/*` paths.
- Exported canonical required paths in `apps/api/src/pipeline/tier-policy.ts` as `TIER3_REQUIRED_CONTRACT_PATHS`.
- Added failure category support:
  - `apps/api/src/pipeline/generation-failure-classifier.ts`
  - `apps/api/src/pipeline/failure-diagnostics.ts`
  - `apps/api/src/pipeline/terminal-quality.ts`
  - `apps/api/src/storage/project-store.ts` classification union
- Fixed Tier 3 export extraction to include `export async function` symbols so named-export validation does not drop valid slices.

## Result
Tier 3 contract artifacts are now generated, validated, preserved through assembly, and required for success.