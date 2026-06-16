# Component Prop Contract Validation Report

## Added validation/repair coverage

### 1. Early slice-stage detection
- File: `apps/api/src/pipeline/tier-slice-validator.ts`
- Added issue code: `component_prop_mismatch`
- Behavior:
  - resolves local component imports
  - infers required props from component prop types
  - detects JSX usages missing required props
  - emits structured mismatch context in message payload

### 2. Final deterministic safety net
- File: `apps/api/src/pipeline/deterministic-generation-contract.ts`
- Behavior:
  - cross-file component usage vs required prop contract scan
  - safe callback props repaired to optional
  - unrecoverable required props produce blocking `generated_component_prop_mismatch`
  - structured violation fields captured in `componentPropViolations`

### 3. Failure classification + diagnostics
- File: `apps/api/src/pipeline/generation-failure-classifier.ts`
  - added `generated_component_prop_mismatch` classification
- File: `apps/api/src/pipeline/failure-diagnostics.ts`
  - added recommended next-action mapping
- File: `apps/api/src/storage/project-store.ts`
  - classification union updated for persistence compatibility
- File: `apps/api/src/pipeline/terminal-quality.ts`
  - failure category union updated

### 4. Deterministic contract diagnostics propagation
- File: `apps/api/src/pipeline/project-generator.ts`
  - `componentPropViolations` included under persisted deterministic diagnostics

## Required diagnostics fields now available for this class
- `failedFile`
- `componentName`
- `missingProp`
- `propType`
- `usageLocation`
- `repairAttempted`
- `repairResult`

## Non-regression scope
- No auth/DB/provider/preview-cache routing changes were introduced.
- Tier routing codepaths were not modified.
- Router/tier classifier tests were re-run to confirm no regression.
