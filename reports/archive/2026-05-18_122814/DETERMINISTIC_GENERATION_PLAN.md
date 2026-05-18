# Deterministic Generation Plan

## Strategy
1. Enforce deterministic infrastructure baseline at slice and final stages.
2. Validate generated artifacts against strict contract before preview/export.
3. Keep build-first repair loop diagnostic-driven (not generic retry inflation).
4. Tier reliability goals by mission complexity.

## Implemented Execution

1. Strict contract module
- Added: `apps/api/src/pipeline/deterministic-generation-contract.ts`
- Enforces required files, scripts, deps, entrypoints, import integrity, max file size, placeholder bans, and manifest schema.

2. Slice-local deterministic enforcement
- Updated: `apps/api/src/pipeline/slice-runner.ts`
- `runPostSliceQuickValidation` now runs deterministic contract and forwards patched artifacts.

3. Final gate deterministic enforcement
- Updated: `apps/api/src/pipeline/project-generator.ts`
- Final assembly now runs deterministic contract (`final-assembly:deterministic-contract`) before QA gate.
- Blocking contract violations now fail generation immediately.
- Contract manifest persisted into project diagnostics.

4. Structured output requirements
- Updated: `apps/api/src/agents/builder-agent.ts`
- Builder validation now enforces:
  - valid/non-empty file entries
  - path validity
  - duplicate path rejection
  - mandatory schema-compliant manifest (synthesized when absent)

5. Build-first loop hardening
- Updated: `apps/api/src/pipeline/execution-validation-scheduler.ts`
- Execution feedback loop now always includes `typecheck` and explicit time budgets.

6. Reliability-tier E2E tracking
- Updated: `apps/api/src/testing/successful-mission-e2e.ts`
- Added Tier 1/2/3 prompt sets and tiered success reporting (`reliabilityByTier`).

## Rollout Order
1. Run tiered E2E (`test:missions:e2e`) on Tier 1 until stable.
2. Lock Tier 1 target: 10/10.
3. Expand to Tier 2 target: 8/10.
4. Expand to Tier 3 target: 6/10.
5. Treat contract violations as generation failures requiring root-cause fixes, not retry expansion.
