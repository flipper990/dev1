# Failure Classification Report

Date: 2026-05-14

## Implemented Classifier
- Added `apps/api/src/pipeline/generation-failure-classifier.ts`.
- Categories:
  - `provider_failure`
  - `orchestration_failure`
  - `artifact_corruption`
  - `empty_generation`
  - `timeout`
  - `preview_failure`
  - `export_failure`
  - `dependency_failure`
  - `unknown`

## Persistence Integration
- Classification is now persisted on project failure:
  - `project.failure.classification`
- Included in failure diagnostics dump path (`last-failure.json` payload).

## Telemetry Integration
- Runtime metrics endpoint (`/api/runtime/metrics`) now exposes:
  - `reliability.failuresByCategory`
  - `reliability.failuresByPhase`
  - `reliability.artifactCorruptionRate`

## Observed Distribution (latest telemetry snapshot)
- `dependency_failure`: 3
- `artifact_corruption`: 1
- `orchestration_failure`: 1
- `unknown`: 22

Classification quality improved, but older historical failures remain unclassified (`unknown`) because they predate this change.
