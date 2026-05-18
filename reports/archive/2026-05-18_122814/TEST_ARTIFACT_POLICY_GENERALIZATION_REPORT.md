# Test Artifact Policy Generalization Report

Date: 2026-05-16

## Objective
Generalize Tier 1 test-artifact handling so non-runtime generated test files do not block preview/export success.

## Implemented changes

### 1. Deterministic contract matcher generalized
Updated `apps/api/src/pipeline/deterministic-generation-contract.ts`:
- broadened test-dir detection to include both `__tests__/` and `tests/`
- broadened allowed path families to include:
  - `tests/**`
  - `apps/**`
  - `packages/**`
  - `src/**`
  - plus existing roots (`app/`, `components/`, `lib/`, `hooks/`, `utils/`, `__tests__/`)

### 2. Tier 1 test-artifact diagnostics expanded
Contract result now persists:
- `testFilesDropped`
- `testFilesIgnored`
- `testImportViolations`
- `testArtifactPathsMatched`
- `runtimeImportViolations`

### 3. Import-repair classification hardened
Updated `apps/api/src/pipeline/import-repair.ts`:
- unresolved imports in test-artifact paths are classified as test-only and ignored for runtime-failure purposes
- runtime unresolved imports remain tracked as runtime violations
- diagnostics expanded with:
  - `testArtifactPathsMatched`
  - `runtimeImportViolations`

### 4. Project diagnostics persistence updated
Updated `apps/api/src/pipeline/project-generator.ts` to persist all expanded test-artifact/runtime-import diagnostics from contract and import-repair phases.

## Tests added/updated
- `apps/api/src/pipeline/deterministic-generation-contract.test.ts`
  - verifies `apps/api/tests/*.test.ts` unresolved imports do not fail runtime contract
  - verifies `tests/*.test.ts` unresolved imports do not fail runtime contract
  - verifies `src/tests/*.test.ts` unresolved imports do not fail runtime contract
  - verifies runtime file unresolved imports still fail
- `apps/api/src/pipeline/import-repair.test.ts`
  - verifies ignore/classification for `apps/api/tests/*.test.ts`
  - verifies ignore/classification for `tests/*.test.ts`
  - verifies ignore/classification for `src/tests/*.test.ts`
  - verifies runtime unresolved imports remain strict and tracked

## Validation run
- deterministic/import/terminal targeted tests: passed
- fast contracts: passed
- package unit tests: passed
