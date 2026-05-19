# PREVIEW_BASELINE_RERUN_RESULTS

Date: 2026-05-19

## Rerun configuration
- Prompt count: exactly 3
- Repeat cycles: 1
- Command: `npm run test:missions:e2e:raw --workspace=@devteam/api`
- Prompts:
  1. Build a simple landing page with hero section, features, and CTA.
  2. Build a simple SaaS dashboard with sidebar, KPI cards, and recent activity.
  3. Build a simple pricing page with three plans and feature comparison.

## Outcome
- Total: 3
- Succeeded: 2
- Failed: 1
- Success rate: 66.67%
- Failure category: `generated_typescript_error` (1)

## Per prompt
1. Landing page
- PASS
- Preview ready, export ok
- Observability fields present in canary result (durations/cache/startCommand/runtimeCwd/phase/log/process state)

2. SaaS dashboard
- PASS
- Preview ready, export ok
- Observability fields present in canary result

3. Pricing page
- FAIL
- Failure during preview build from generated TypeScript incompatibility in `src/components/ui/Button.tsx`
- Observability captured:
  - `previewFailurePhase`: `preview:failed`
  - `previewFailureReason`: populated with build diagnostics
  - `buildExitCode`: `1`
  - `currentPreviewPhase`: `preview:failed`
  - `processState`: `alive-hanging`
  - duration fields populated where applicable

## Artifact
- `apps/api/src/testing/successful-mission-results.json` updated with new observability fields per result.
