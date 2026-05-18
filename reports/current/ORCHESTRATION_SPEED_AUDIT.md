# ORCHESTRATION_SPEED_AUDIT

Date: 2026-05-18
Scope: Tier 1 speed bottlenecks before/after FAST_TIER1_PATH.

## Evidence sources
- Legacy baseline: `apps/api/src/testing/tier1-repeatability-data.json` (10-mission Tier1 repeatability run)
- Legacy preview step timings: `apps/api/src/testing/last-local-preview-failure.json`, `apps/api/src/testing/last-preview-runtime-failure.json`
- Fast-path canaries: `reports/current/canary-1-results.json`, `reports/current/canary-3-results.json`, `reports/current/canary-5-results.json`
- Fast-path mutation ledgers: `apps/api/src/testing/project-state-mutations-*.jsonl` for canary project IDs

## Baseline bottlenecks (before fast path)
- Baseline average mission runtime: `382,796 ms` (~6.38 min)
- Baseline success rate: `3/10` (`30%`)
- Baseline retry frequency: `0.3`
- Legacy generation window (reserve -> terminal generated/failed) average: `529,941 ms` (~8.83 min)
- Legacy preview step sample (from runtime failure artifact):
  - install: `39,953 ms`
  - build: `9,543 ms` (+ one extra build retry `6,870 ms`)

## Fast Tier 1 observed durations (canary set)
Derived across 9 canary missions via project-state-mutation timestamps.

- `generation (reserve -> fast-tier1 final save)`: avg `91 ms`
- `queue_to_preview_start`: avg `2,946 ms`
- `preview_starting -> reachable`: avg `56,022 ms`
- `reachable -> ready`: avg `886 ms`
- `other`: avg `412 ms`

## Slowest 5 phases (current Tier 1 fast path, observed)
1. `preview_starting -> reachable`: `56,022 ms`
2. `queue_to_preview_start`: `2,946 ms`
3. `reachable -> ready`: `886 ms`
4. `other runtime overhead`: `412 ms`
5. `generation (fast path core)`: `91 ms`

## Unnecessary Tier 1 work detected in legacy path
- Late failures at `final-assembly` (`4/10`) and `qa-gate` (`3/10`) show expensive work finishing before deterministic failure.
- Backend/test artifacts entered Tier1 pipelines in baseline failures (contract violations in test-route files), causing avoidable late-stage failures.
- Repeated heavy preview install/build steps were still paid before some type/contract issues surfaced.

## Where validation happened too late (legacy)
- `final-assembly` deterministic-contract failures after long generation windows.
- `qa-gate` failures after full slice orchestration.
- Preview-time TypeScript contract failures (example `PrimaryCTA.tsx`) detected only after install/build startup work.

## Conclusion
Current fast Tier1 architecture removed generation as the main bottleneck for simple prompts; preview startup is now the dominant runtime cost center.
