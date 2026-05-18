# Run-to-Run Comparison Report

Date: 2026-05-17

## Compared Runs
1. Historical stabilized Tier 1 run: 9/10.
2. Historical regressed Tier 1 run: 7/10.
3. Current restarted run context: latest e2e attempts blocked by provider unavailability.

## Prompt Stability
- Passed in 9/10 and failed in 7/10: SaaS dashboard, docs/help center.
- Failed in both historical runs: admin overview.
- Stable pass across the two historical runs: landing, marketing, portfolio, product, pricing, waitlist, analytics.
- In current environment-wide outage attempts: all prompts can fail due provider unavailability; this is external to artifact policy logic.

## Code-Path Correlation
- Test-artifact policy change correlates with elimination of test-artifact import failures.
- 7/10 regression clusters correlate with orchestration state handling and artifact assembly/dependency reconciliation boundaries.
- Current all-fail attempts correlate with provider/model availability, not deterministic artifact contract paths.

## Flaky Prompts
- Historically flaky (between 9/10 and 7/10): SaaS dashboard, docs/help center.
- Outage-induced flakiness currently masks intrinsic prompt stability.
