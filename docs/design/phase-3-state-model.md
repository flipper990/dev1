# Phase 3 Unified State Model

## Canonical states
- idle
- generating
- build complete
- preview starting
- preview ready
- preview failed
- stale / out-of-sync
- verification pending
- launch ready

## Rules
- Exactly one canonical state per project surface.
- Status badges across page sections must derive from the same resolver.
- Contradictory status combinations are treated as stale/out-of-sync.

## Derivation priorities
1. Explicit stale/out-of-sync condition.
2. Generating build in progress.
3. Preview failure.
4. Preview startup phases.
5. Preview readiness.
6. Verification pending vs launch ready based on checks.
7. Build complete without runtime preview.

## Presentation
Each state provides:
- label
- description
- lifecycle stage
- health boolean
- tone
- next action

This model is implemented in `src/features/projects/model/project-status.ts` and consumed across Home, Workspace, Projects, and Activity surfaces.
