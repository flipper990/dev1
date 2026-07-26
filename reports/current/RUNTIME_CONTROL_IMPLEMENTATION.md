# Runtime Control Implementation

## Outcome

The engineering workspace now exposes authenticated, project-scoped runtime controls and a live execution console. Controls operate at deterministic generation stage boundaries so a model call or file write is never interrupted midway.

## Implemented controls

- Pause and resume a run.
- Stop a run at the next safe boundary.
- Skip, approve, or reject the current paused stage.
- Retry the retained failed stage context or retry the complete retained prompt.
- Roll back to the latest durable checkpoint.
- Restore the latest prior successful revision.

## Live execution data

- Stage progress and lifecycle state.
- Current agent and task.
- Estimated remaining time and elapsed time.
- Tokens, cost, retry count, dependencies, produced artifacts, and stage records.
- Polling every 1.8 seconds with accessible progress semantics and status messaging.

## Architecture

- `ProjectGenerator` owns the in-memory control registry tied to the active project and session.
- Safe points are installed before specification, slice planning, every incremental slice, and finalization.
- Retry updates are registered as runtime executions and reuse the existing project updater and retained project state.
- `GET /api/projects/:id/runtime` is viewer-readable.
- `POST /api/projects/:id/runtime/control` requires project member access.
- Rollback and restoration reuse durable revision snapshots and optimistic version checks.

## Safety semantics

Pause, stop, skip, approve, and reject are cooperative. If a model request is already executing, it finishes before the command is applied at the next boundary. This avoids partial artifacts and inconsistent persisted state. ETA is explicitly calculated from elapsed time and observed completion, not presented as a deadline.

## Files changed

- `apps/api/src/pipeline/project-generator.ts`
- `apps/api/src/routes/version-routes.ts`
- `apps/api/src/routes/api-contract.test.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/workspace/page.tsx`
- `apps/web/src/features/workspace/components/RuntimeControlPanel.tsx`
- `apps/web/src/features/workspace/components/index.ts`

## Investigation agents

- Bacon traced generation execution and identified safe interruption boundaries.
- Planck audited snapshots, checkpoints, and restoration guarantees.
- Mill mapped live telemetry and distinguished ETA from existing timeout data.
- Herschel reviewed workspace placement and recommended a contextual runtime console.
- Sartre reviewed API, authorization, and test contracts.

All agents investigated read-only. The lead agent produced the single merged implementation.

## Verification

- `npm run type-check --workspace=@devteam/api` — passed.
- `npm run type-check --workspace=@devteam/web` — passed.
- `npm test --workspace=@devteam/api` — 23 tests passed.
- `npm run test:smoke:routes --workspace=@devteam/web` — 8 route variants passed.
- `npm run test:smoke:a11y --workspace=@devteam/web` — 5 routes passed.
- `npm run build --workspace=@devteam/api` — passed.
- `npm run build --workspace=@devteam/web` — passed; 39 static pages generated.

## Remaining limitation

Runtime control state is process-local. A server restart retains durable project revisions but not a paused in-memory execution. Persisting and rehydrating active orchestration state is the recommended next hardening step.
