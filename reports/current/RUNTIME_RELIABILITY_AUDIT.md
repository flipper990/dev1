# RUNTIME RELIABILITY AUDIT

Date: 2026-05-18

## Reliability History (Measured from existing artifacts)
1. Historical evidence indicates Tier 1 reached 9/10 in a stabilized run (`RUN_TO_RUN_COMPARISON_REPORT.md`, `TIER1_REGRESSION_ANALYSIS.md`).
2. Later reruns regressed to 7/10 (`FINAL_TIER1_REPEATABILITY_REPORT.md` and related reports).
3. Archived readiness decisions also show lower outcomes (including 3/10 in `TIER1_PRODUCTION_READINESS_DECISION.md`).
4. Latest current canary (`reports/current/CANARY_1_RESULT.md`) failed with EPERM during project directory creation, followed by project 404/session 403 timeout.

## Current Reliability Truth
- Current state is uncertain and unstable until a clean rerun produces authoritative data.
- Existing evidence is not monotonic and includes contradictory snapshots from different run windows.

## Failure Cluster Themes
1. Project persistence and filesystem write failures (EPERM on `data/projects` mkdir/tmp writes).
2. Orchestration/state drift around terminal transitions and retries.
3. Artifact/dependency integrity failures in assembly/finalization paths.
4. Preview runtime timeout and install/build fragility under cold/fullstack conditions.
5. Provider availability/circuit-breaker effects in some historical windows.

## Tier Assessment
- Tier 1: Not locked, unstable.
- Tier 2+: Not ready for confidence gating while Tier 1 remains unstable.

## Must Be True Before Tier 2 Work
1. Root gate commands must be trustworthy (`test`, `lint`, `type-check`, `build`).
2. Canary sequence (1 -> 3 -> 5 prompts) must pass on clean environment with consistent artifact retention.
3. EPERM/persistence issues must be eliminated and monitored.
4. Preview watchdog budgets must be validated against realistic cold-start timings.
5. One authoritative reliability report pipeline must replace fragmented run artifacts.

## Immediate Reliability Blockers
- EPERM project persistence during mission start.
- Broken/misleading root QA orchestration.
- API lint/build failures.

## Reliability Decision
Current reliability maturity: fragile internal alpha, not demo-grade repeatable.
