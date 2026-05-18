# PREVIEW_RUNTIME_FIX_REPORT

## Code Changes

### 1) Build-first local preview validation + phase/timeouts
File: `apps/api/src/preview/local-runner.ts`

- Added explicit build phase before dev startup when build script exists and stack is Next/Vite/React.
- Added dedicated constants:
  - `INSTALL_TIMEOUT_MS = 240000`
  - `BUILD_TIMEOUT_MS = 120000`
  - `READY_TIMEOUT_MS = 90000`
- Added `runBuild(...)` with:
  - isolated process spawn
  - stdout/stderr capture into ring buffers
  - explicit build-timeout error and build-exit diagnostics
- Added failure cleanup path for build failure:
  - snapshot failure
  - release allocated port
  - remove live record

### 2) Failure snapshot retention surfaced to manager
Files:
- `apps/api/src/preview/local-runner.ts`
- `apps/api/src/preview/preview-manager.ts`

- Added `LocalPreviewFailureSnapshot` and `failedRecords` map.
- Added `getLastFailure(projectId)`.
- Manager now uses `localRunner.get(projectId) ?? localRunner.getLastFailure(projectId)` when local start fails.
- Preserves error tails/exit metadata even after runner cleanup.

### 3) Local preview phase wiring
File: `apps/api/src/preview/preview-manager.ts`

- Extended local `onPhase` to accept `'building'`.
- Maps it to `preview:building` for timeline/state clarity.

## Install reliability hardening
File: `apps/api/src/preview/local-runner.ts`

- `npm install` now uses project-local cache under `.preview-runtime/.npm-cache` (`--cache` + env cache vars), reducing host-cache permission friction.

## Outcome
- Runtime now emits specific build/install/start errors instead of collapsing to generic startup timeout in these paths.
- Local runner diagnostics are preserved for postmortem even when live process record is gone.
