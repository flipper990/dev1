# Deadlock Fixes

## Problem
Missions could remain in `status=active` indefinitely with no meaningful progress updates.

## Fixes Applied
- Added watchdog sweep in server runtime loop (`app.ts`):
  - mission timeout detection
  - stalled-step detection
  - heartbeat-timeout detection
- Added session manager deadlock/freeze detection logic (`sweepStalled`).
- Added forced terminal failover when watchdog trips.
- Added project-level fail persistence for watchdog failures:
  - project status -> `failed`
  - verification status -> `failed`
  - failure diagnostics persisted
  - progress phase stamped to watchdog terminal phase

## Result
The runtime no longer permits infinite active-state deadlocks; stalled runs are forced into explicit terminal failure with diagnostics.

## Automated Validation
- `session-manager.test.ts` validates timeout and stalled-step failover behavior.
