# Complexity Scaling Report

Date: 2026-05-14

## Implemented Complexity-Aware Orchestration
- Added generation complexity scoring in `project-generator` based on:
  - planned slices
  - pages/routes/api contracts/entities/components
- Persisted to:
  - `project.diagnostics.generationComplexity`

## Adaptive Policies Added
- QA loop budget:
  - high complexity: `MAX_QA_LOOPS + 1`
  - low/medium complexity: baseline
- Builder-empty local recovery budget:
  - high complexity: 2 local retries
  - low/medium complexity: 1 local retry
- Soft deadline scaling:
  - low: 1.0x
  - medium: 1.2x
  - high: 1.45x
  - still bounded by global hard timeout.

## Operational Effect
- Reduced premature timeout pressure on complex workloads.
- Reduced all-or-nothing failure behavior by keeping retries and recovery scoped to failing slices.

## Remaining Gap
- Complexity-aware budgets improve stability but are not yet sufficient for high-confidence repeated mission completion.
- Additional hardening still required in final status consistency and export-path determinism.
