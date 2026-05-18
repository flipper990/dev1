# Import Repair Fix Report

## Implemented changes

### 1. New deterministic import-repair module
- Added: `apps/api/src/pipeline/import-repair.ts`
- Entry point: `runDeterministicImportRepair(files)`
- Repair actions:
  - remove unresolved import when all imported bindings are unused
  - rewrite to canonical existing path when recoverable
  - create safe local stub/barrel file for recoverable missing local imports
  - leave unrecoverable imports as explicit diagnostics

### 2. Final pre-fail import repair pass in final assembly
- Updated: `apps/api/src/pipeline/project-generator.ts`
- Flow change:
  - after deterministic contract run
  - if blocking violations are all dangling imports
  - run deterministic import repair once
  - re-run deterministic contract
  - fail only if unresolved blocking violations remain

### 3. Persisted repair diagnostics
- Persisted under `project.diagnostics.importRepair`:
  - `importRepairAttempted`
  - `importRepairPasses`
  - `importsRepaired`
  - `importsRemoved`
  - `filesCreatedForImports`
  - `unrecoverableImports`
  - `remainingBlockingViolationsAfterRepair` (when failure remains)

## Safety boundaries
- No provider logic changes.
- No blind contract loosening.
- Only local import recovery is attempted.
- Unsafe/non-local unresolved imports remain hard-fail.

## Tests added
- `apps/api/src/pipeline/import-repair.test.ts`
  - unresolved local component import creates safe stub
  - unresolved unused import is removed
  - root-to-src mismatch import rewritten to canonical path
  - unrecoverable unsafe local import remains unresolved
  - diagnostics payload populated

## Measured effect in rerun
- Previous unresolved-import failures: 2
- Current unresolved-import failures: 1
- Remaining unresolved-import failure was in generated `__tests__/*` imports under final assembly, not in normal app runtime files.
