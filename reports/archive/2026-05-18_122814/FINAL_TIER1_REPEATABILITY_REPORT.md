# Final Tier 1 Repeatability Report

Date: 2026-05-16

## Rerun scope
Reran the exact same 10 Tier 1 prompts via:
- `npm --workspace @devteam/api run test:missions:e2e:raw`
- `PROMPTS_JSON` set to the same 10 prompt list.

## Measured result
Source: `apps/api/src/testing/successful-mission-results.json`

- Total missions: 10
- Successes: 7
- Failures: 3
- Success percentage: 70%
- Preview ready count: 7/10
- Export ok count: 7/10
- Test-artifact failures: 0
- Runtime import failures: 0

## Failure details

1. index 1 (simple SaaS dashboard)
- Project/session: `AACxH8DsmpFW / rkqd_OSsnExx0Vtg`
- Category/phase: `orchestration_failure / slice-6/7`
- Reason: `project status=generating with missing explicit error`
- Observed state drift: project later persisted as `generated`

2. index 5 (simple admin overview)
- Project/session: `lKm6kHS2zrVq / 7O-mMBRU1cTaF64z`
- Category/phase: `artifact_corruption / final-integrity-gate`
- Reason: `Final integrity gate FAILED — 1 unresolved package import(s): bcrypt`

3. index 6 (simple docs/help center)
- Project/session: `0PRRh-pUqT5T / t-xQTzWn4palrNJj`
- Category/phase: `orchestration_failure / finalize`
- Reason: `ENOENT ... mkdir ...\src\app\articles\:slug`

## Cluster summary
- `orchestration_failure`: 2
- `artifact_corruption`: 1
- `unknown`: 0
- `terminal-state` hard failure count: 0 (but one observer mismatch case remains)

## Delta vs previous 9/10 run
- Final test-artifact import cluster (`apps/api/tests/*.test.ts`) was eliminated.
- New non-test-artifact failure clusters appeared, reducing overall run to 7/10.
