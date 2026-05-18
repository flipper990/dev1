# Snapshot Failure Fix Report

- Timestamp: 2026-05-18 12:53:15 +02:00
- Error addressed: `this.snapshotFailure is not a function`

## Root Cause
Failure snapshot persistence in `LocalPreviewRunner` depended on an instance method call in critical error paths. In detached/mismatched runtime contexts, this could throw and mask the real install/build failure.

## Fix Applied
- Introduced context-free snapshot helper in:
  - `apps/api/src/preview/local-runner.ts`
- Replaced failure-path writes to use helper at all local runner failure snapshot points.

## Validation
- `npx tsx --test src/preview/local-runner.env.test.ts src/preview/local-runner.failure-snapshot.test.ts src/preview/preview-manager.fail-classification.test.ts`
- Result: pass (`7/7`).

## Notes
- Added targeted snapshot tests covering install/build failure snapshot persistence without crashing.
