# Test Artifact Policy Fix Report

Date: 2026-05-16

## Implemented Policy
Tier 1 runtime success must not be blocked by generated test-only artifacts.

## Changes
- `apps/api/src/pipeline/deterministic-generation-contract.ts`
  - Added Tier 1 test artifact policy metadata:
    - `testFilesDropped`
    - `testFilesIgnored`
    - `testImportViolations`
    - `testArtifactPolicyReason`
  - Expanded test artifact detection to include `__tests__/` directories and `.test/.spec` files.
  - Drops generated test artifacts before runtime import blocking checks.
- `apps/api/src/pipeline/import-repair.ts`
  - Added `testImportsIgnored` diagnostics.
  - Ignores unresolved imports whose importer is a generated test artifact.
  - Keeps runtime imports strict and still fails unrecoverable runtime imports.
- `apps/api/src/pipeline/project-generator.ts`
  - Persists deterministic contract test-artifact diagnostics into project diagnostics.
  - Persists import-repair `testImportsIgnored` diagnostics.

## Tests Added/Updated
- `apps/api/src/pipeline/deterministic-generation-contract.test.ts`
  - Verifies generated test artifacts (including top-level `__tests__/...`) are dropped and do not trigger blocking runtime import failures.
- `apps/api/src/pipeline/import-repair.test.ts`
  - Verifies unresolved imports in generated `__tests__` files are ignored/classified, not hard-failed.

## Measured Impact
- Previous unresolved-import failures from generated `__tests__/*`: eliminated.
- Current rerun residual: one failure from `apps/api/tests/*` unresolved imports (separate path pattern, next narrow fix).
