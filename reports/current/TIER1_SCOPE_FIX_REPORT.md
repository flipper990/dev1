# Tier1 Scope Fix Report

- Timestamp: 2026-05-18 12:53:15 +02:00

## Changes
- Deterministic contract now supports explicit backend allowance override:
  - `allowBackendRuntimeArtifacts` option (default: `false`)
- Project generator now infers backend/full-stack prompt intent and passes the override into deterministic contract calls.
- Tier1 default remains frontend-preview-safe and excludes backend runtime artifacts.
- Tier1 test-artifact policy tightened to exclude source files under tests directories by default (including `packages/**/tests/**`).

## Files
- `apps/api/src/pipeline/deterministic-generation-contract.ts`
- `apps/api/src/pipeline/project-generator.ts`
- `apps/api/src/pipeline/test-artifact-policy.ts`
- `apps/api/src/pipeline/deterministic-generation-contract.test.ts`
- `apps/api/src/pipeline/test-artifact-policy.test.ts`
- `apps/api/src/pipeline/import-repair.test.ts`

## Validation
- Deterministic contract and policy tests passed.
- Import repair tests passed with updated Tier1 scope behavior.
