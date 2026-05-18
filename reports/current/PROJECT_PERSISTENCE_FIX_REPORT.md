# Project Persistence Fix Report

## Problem
EPERM/EBUSY failures in project persistence caused mission startup failures and downstream session visibility instability.

## Fixes Implemented

### 1) Windows-safe persistence retries
In `apps/api/src/storage/project-store.ts`:
- Added retry-backed helpers:
  - `mkdirWithRetry(...)`
  - `writeFileWithRetry(...)`
- Applied retries to critical paths:
  - `init()` base dir mkdir
  - `save()` project dir mkdir, output dir mkdir, output file writes
  - `update(...persistFiles)` dir/output mkdir + writes
  - `saveSnapshot()` dir mkdir
  - atomic write temp stage now retries temp-write stage (`atomic-write-temp-json`) before rename

### 2) No partial `project.json` persistence behavior preserved
- Atomic write remains tmp+sync+rename.
- Retry logic added without changing atomic semantics.

### 3) Classified reservation-time persistence failures
In `apps/api/src/routes/api.ts`:
- Catch around `reservation.placeholderSaved` now returns classified code:
  - `FILESYSTEM_PERMISSION_FAILURE` when underlying error is permission-like
  - otherwise `PROJECT_PERSISTENCE_FAILURE`

### 4) Prevent 404/403-style progress chain from missing session progress
In `apps/api/src/pipeline/session-manager.ts`:
- `markProviderUnavailable(...)` now creates terminal progress/session records if session was not yet created.
- Added regression test in `session-manager.test.ts`.

## Validation
- `npx tsx --test apps/api/src/storage/project-store.persistence.test.ts` -> PASS
- `npx tsx --test apps/api/src/pipeline/session-manager.test.ts` -> PASS
- Canary 1 mission reserved and persisted project successfully; failure occurred later in generated app build/type stage, not persistence.
