# Component Prop Mismatch Analysis

## Scope
- Failure class addressed: generated component prop-contract mismatch.
- Original blocker signature (previous targeted run):
  - `./src/app/logout/page.tsx:7:8`
  - `LogoutButtonProps.onLogout` required while `<LogoutButton />` was rendered without prop.

## Root cause
- Cross-file JSX prop contract validation did not exist before preview build.
- Deterministic contract and slice validator enforced import/export and structural rules, but did not verify required component props across local imports/usages.
- Result: mismatch surfaced late during preview build typecheck.

## Provenance findings (from prior failing project BAoc04Cw91kX)
- `LogoutButtonProps` required `onLogout: () => void`.
- `src/app/logout/page.tsx` rendered `<LogoutButton />` with missing prop.
- Evidence indicated fallback/repair drift contributed to required prop without guaranteed callsite wiring.

## Implemented deterministic fix
1. Deterministic contract repair/validation added:
- `apps/api/src/pipeline/deterministic-generation-contract.ts`
  - Added component prop contract pass that inspects local component imports/usages.
  - Safe callback props (`onX` callback signatures) are made optional deterministically when missing at usage.
  - Unrecoverable required props fail with `generated_component_prop_mismatch` including structured fields.

2. Structured diagnostics surfaced:
- `failedFile`
- `componentName`
- `missingProp`
- `propType`
- `usageLocation`
- `repairAttempted`
- `repairResult`

3. Early validation added:
- `apps/api/src/pipeline/tier-slice-validator.ts`
  - New issue code: `component_prop_mismatch`.
  - Detects missing required props for local component usage before final assembly.

4. Failure classification added:
- `apps/api/src/pipeline/generation-failure-classifier.ts`
  - New category: `generated_component_prop_mismatch`.
- `apps/api/src/pipeline/failure-diagnostics.ts`
  - Added next-action mapping for this class.

## Current class status
- Targeted pipeline tests confirm this class is now detected/repaired/classified deterministically.
- In the latest one-prompt rerun, this specific logout prop mismatch did not recur as the terminal blocker.
- Latest rerun failed for a different class (`generated_app_build_failure`) due lint/type quality issues (`no-explicit-any`, `@ts-ignore`) in other generated files.
