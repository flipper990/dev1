# Success Rate Report

Date: 2026-05-14

## Latest Real Mission Run
Source: `apps/api/src/testing/successful-mission-results.json`

- Total missions: 1
- Succeeded: 0
- Failed: 1
- Success rate: 0%
- Preview startup success: 0%
- Export success rate: 0%

## Runtime Telemetry Snapshot
- Terminal missions: 31
- Completed: 3
- Failed: 28
- Aggregate success rate: 9.7%
- Provider failure rate (required providers): 0%

## Interpretation
- Core blocker is no longer provider availability.
- Reliability failures are primarily orchestration/artifact/export consistency issues.

## CI Test Path
- E2E mission validator script updated for repeated workload cycles:
  - `apps/api/src/testing/successful-mission-e2e.ts`
  - supports `REPEAT_CYCLES`
  - captures per-run failure category distribution
