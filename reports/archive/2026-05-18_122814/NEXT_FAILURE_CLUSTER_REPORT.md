# NEXT_FAILURE_CLUSTER_REPORT

## Remaining/next failure cluster after this fix set
1. **Environment bootstrap blockers**
- DB preflight hard-fails mission E2E when Postgres is unreachable.
- Docker daemon absence prevents local `db:up` recovery.

2. **Builder-output quality/truncation cluster (upstream generation)**
- Builder can still produce unusable output when provider responses are truncated/incomplete.
- Current behavior is now correctly classified and traced, but root generation quality remains a potential runtime failure source.

3. **Pre-existing preview/runtime compile debt (outside this task scope)**
- `local-runner.ts` / `preview-manager.ts` type issues are present in workspace and affect full typecheck confidence.

## Priority order
1. Restore local runtime prerequisites (Postgres/Docker) and run one Tier 1 mission for post-fix measurement.
2. If failure repeats with zero files, use `generationFailureTrace` + `last-builder-empty-failure.json` to target builder truncation mitigation.
3. Address unrelated preview/runtime typing debt separately to recover full CI typecheck confidence.
