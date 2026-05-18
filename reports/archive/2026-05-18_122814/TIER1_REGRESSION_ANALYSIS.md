# Tier 1 Regression Analysis (Restarted Run)

Date: 2026-05-17
Scope: Tasks 1-7 (analysis through targeted testing)

## Baseline vs Regressed Run
- Previous stable run: 9/10 success, preview 9/10, export 9/10.
- Regressed run: 7/10 success, preview 7/10, export 7/10.
- Test-artifact failures: eliminated (0).
- New clusters in regressed run: orchestration_failure (2), artifact_corruption (1).

## Root Cause Summary
1. Orchestration failure cluster in 7/10 run was primarily terminal-state sync and persistence classification quality, not test-artifact import failures.
2. Artifact corruption cluster in 7/10 run included post-QA dependency drift (notably missing runtime dependency reconciliation after QA mutations).
3. Generalized test-artifact policy removed the original test-import failure class but needed explicit runtime-preservation safeguards and regression coverage.

## Current Restart Investigation Notes
- Latest three failed missions in the current environment are provider/model unavailability failures at qa-gate/spec step ("All models exhausted ... unavailable").
- These latest failures do not contradict the historical 7/10 regression findings; they are an external availability blocker.

## Fix Direction Implemented
- Runtime-safe test-artifact filtering behavior retained and tightened with explicit tests.
- Orchestration terminal sync and failure diagnostics made explicit.
- Post-QA dependency reconciliation enforced before final integrity gate.
- Path normalization coverage includes Windows `:slug` segment normalization.

## Status
- Targeted deterministic validation suite: PASS.
- Full 10-prompt rerun: pending provider/network stability.
