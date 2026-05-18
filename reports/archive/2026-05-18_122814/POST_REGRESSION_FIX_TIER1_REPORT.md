# Post Regression-Fix Tier 1 Report

Date: 2026-05-17
Run Type: Full rerun of the same Tier 1 10 prompts

## Totals
- Total missions: 10
- Successes: 0
- Failures: 10
- Success rate: 0%
- Preview ready: 0
- Export ok: 0

## Failure Counts
- orchestration_failure: 10
- artifact_corruption: 0
- test-artifact failures: 0
- runtime import failures: 0

## Dominant Failure Phases/Reasons
- finalize: `install exited with code 1` (9/10)
- qa-gate: `QA gate failed: score 90/100, blockers=1` (1/10)

## New Failure Clusters
- Yes: finalize install failures dominated this run.

## Notes
- This run does not satisfy Tier 1 lock criteria.
- Historical 7/10 regression explanation remains valid; however, current environment/pipeline produced a broader failure mode during full rerun.
