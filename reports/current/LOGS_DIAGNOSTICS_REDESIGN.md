# Logs and Diagnostics Redesign

## Outcome

Logs and Diagnostics now share a causal evidence model. Logs handles chronological, high-volume inspection; Diagnostics leads with the best available root cause and collapses secondary failures.

## Logs

- Search across messages, stack traces, stages, agents, runtimes, and related files.
- Severity and runtime-source filters.
- Chronological, stage, agent, and runtime grouping.
- Follow/pause behavior that tracks new project evidence snapshots.
- Millisecond timestamps.
- Download of the filtered evidence set as a `.log` file.
- Selected-event detail inspector.
- Expandable raw errors and stack traces.
- Copy error and copy command actions.
- Related file, agent, and prompt navigation.
- Root-cause highlighting and downstream-failure collapsing.
- Dependency-free fixed-row virtualization above 150 rows with overscan.

## Diagnostics

- Root-cause precedence: persisted generation failure trace, build validation, runtime validation, framework overlay, then preview failure.
- Highlighted failed stage, step, and agent.
- Recommended recovery when persisted by the pipeline.
- Correlated-log navigation.
- Downstream runtime failures collapsed by default.
- Existing probes, commands, dependency evidence, stdout, stderr, runtime state, and retry controls retained.

## Evidence normalization

The workspace now merges pipeline-ledger records, preview timeline events, runtime process snapshots, preview errors, execution build/runtime errors, runtime-validation issues, and structured generation failure traces into the log view. Related source paths are taken only from retained changed-file history and exact message matches; CodeWorkbench validates the requested path before opening it.

## Files changed

- `apps/web/src/features/logs/components/LogEvidenceView.tsx`
- `apps/web/src/features/workspace/hooks/useWorkspaceProject.ts`
- `apps/web/src/features/workspace/components/DiagnosticsSummary.tsx`
- `apps/web/src/features/workspace/components/CodeWorkbench.tsx`
- `apps/web/app/workspace/page.tsx`

## Investigation agents

- logs_data mapped persisted pipeline, preview, validation, crash, and diagnostic evidence.
- logs_ui designed the evidence workbench and causal hierarchy.
- logs_navigation traced safe source, prompt, agent, and URL navigation.
- logs_perf defined dependency-free virtualization, follow, copy, and download behavior.

All agents investigated read-only. The lead agent produced one merged implementation.

## Verification

- Web typecheck passed.
- Web production build passed; 39 static pages generated.
- Route smoke passed for 10 route/flag variants.
- Accessibility smoke passed for 5 application routes.

## Current backend boundary

The existing backend persists capped preview/runtime tails and project evidence snapshots, not a cursor-based durable log stream. Follow mode therefore follows newly received project evidence; it does not claim to expose omitted historical terminal output. A cursor/SSE evidence endpoint is the recommended next step for lossless production log streaming.
