# Generated App Build Fix Report

## Scope
Scoped fix only for generated TypeScript/build blocker path.

## Code changes
1. `apps/api/src/pipeline/ui-foundation.ts`
- Added deterministic `repairBrokenButtonContract(fileMap)`.
- `sanitizeUIFoundation(...)` now repairs broken `Button` contract before downstream build/preview.
- Repair enforces canonical `Button` with:
  - `variant` + `size` support
  - `as: 'a'` anchor compatibility
  - safe default button type
- Updated injected canonical Button template (when Button file is missing) to same contract.

2. `apps/api/src/preview/local-runner.ts`
- Added `extractBuildFailureDiagnostics(rawLog)`.
- Build failures now include explicit structured diagnostics before preview startup:
  - `phase=preview:building`
  - `failedFile=<path:line:col>` (if detected)
  - `errorMessage=<compiler message>`
  - `recommendedRepairPath=<deterministic next action>`

## Why this is deterministic
Fix is applied in generator repair path (`sanitizeUIFoundation`) and local build guard path, not by patching one generated output artifact.

## Result
- Canary 1 prompt now builds and previews successfully.
- Build failures now fail fast with concrete diagnostics instead of ambiguous tails.
