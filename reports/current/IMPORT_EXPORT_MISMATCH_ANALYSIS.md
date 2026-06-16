# Import/Export Mismatch Analysis

## Target class
- `generated_import_export_mismatch`
- Original symptom: React hook (`useEffect`) reported as imported from `@/lib/api-client` in `src/app/logout/page.tsx`.

## Root cause identified
- Deterministic contract named-import extraction previously allowed cross-statement misassociation in import parsing, which could bind symbols from one import statement to the module specifier of another.
- This produced false-positive mismatch classification in final deterministic contract checks.

## Deterministic fix implemented
- Import extraction and enforcement were hardened in:
  - `apps/api/src/pipeline/deterministic-generation-contract.ts`
- React hook source enforcement now deterministically repairs hooks to `react` in the contract path:
  - `enforceReactHookImportSourceContract(...)`
  - `repairReactHookImportSources(...)`
- Early slice validation now catches hook wrong-source imports before final assembly:
  - `apps/api/src/pipeline/tier-slice-validator.ts` (`react_hook_wrong_source`)
- Unrecoverable mismatch diagnostics now include structured fields:
  - `failedFile`
  - `invalidImportName`
  - `importedFrom`
  - `expectedSource`
  - `repairAttempted`
  - `repairResult`

## Verification evidence
- Targeted pipeline/contract/validator tests passed after fix.
- API typecheck/build passed after fix.
- Single dashboard rerun (2026-05-28, one prompt only) did **not** fail with `generated_import_export_mismatch`.

## Current status of this class
- **Resolved for this rerun path**.
- Latest blocker moved to a different class: generated TypeScript prop mismatch in generated UI code (`LogoutButton` required prop not supplied).
