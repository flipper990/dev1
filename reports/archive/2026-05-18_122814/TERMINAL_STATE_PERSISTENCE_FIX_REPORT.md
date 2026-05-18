# Terminal State Persistence Fix Report

Date: 2026-05-16

## Problem
A mission could end terminally while project state remained `generating`, and diagnostics could miss an explicit failure reason.

## Changes
- `apps/api/src/pipeline/project-generator.ts`
  - Hardened `persistProjectFailure`:
    - If `projectStore.save` fails, fallback `projectStore.update` now forcibly persists terminal failed state and structured diagnostics.
- `apps/api/src/pipeline/terminal-state-consistency.ts` (new)
  - Added deterministic invariant evaluator for session/project terminal consistency.
  - Maps terminal session states to expected project lifecycle state.
- `apps/api/src/app.ts`
  - Added cleanup-loop reconciliation pass:
    - If session terminal state and project lifecycle are inconsistent, repair immediately.
    - Persist `diagnostics.terminalStateConsistency` event trail.
    - Ensure failed terminal sessions persist explicit failure reason/category/phase defaults.
- `apps/api/src/testing/successful-mission-e2e.ts`
  - `waitMission` now detects terminal session while project remains `generating` and exits with explicit failure context instead of opaque timeout.
- `apps/api/src/testing/mission-failure-diagnostics.ts`
  - Explicit reason extraction for `session failed + project generating` scenario.

## Tests Added/Updated
- `apps/api/src/pipeline/terminal-state-consistency.test.ts` (new)
  - Failed terminal session -> expected project `failed` with explicit reason.
  - Completed terminal session -> expected project `generated`.
- `apps/api/src/testing/mission-failure-diagnostics.test.ts`
  - Added explicit terminal mismatch reason case.

## Measured Impact
- Current 10-mission rerun: terminal-state mismatch failures = 0.
- No `project status=generating with missing explicit error` failures observed.
