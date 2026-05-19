# Generated TypeScript Failure Analysis

## Scope
- Investigated the latest 3-prompt baseline failure that was previously classified as `generated_typescript_error`.
- Inputs inspected:
  - `reports/current/PREVIEW_BASELINE_RERUN_RESULTS.md` (existing prior run context)
  - `apps/api/src/testing/successful-mission-results.json`
  - `apps/api/src/testing/last-failure.json`
  - `apps/api/src/testing/last-local-preview-failure.json`
  - `apps/api/src/testing/last-preview-runtime-failure.json`

## Exact failed prompt (pre-fix baseline)
- Prompt: `Build a simple SaaS dashboard with sidebar, KPI cards, and recent activity.`
- Tier classification in results: `custom` (prompt set override execution path)
- Failed project/session:
  - `projectId=OdTk_U0DvJrN`
  - `sessionId=Gj-bz-0NWkEPuM7k`
- Failure category: `generated_typescript_error`
- Failure phase: `finalize` with preview build phase `preview:building`
- Build diagnostics:
  - `buildExitCode=1`
  - `failedFile=./src/components/dashboard/ActivityFeed.tsx:49:31`
  - Error: `Type '{ activity: Activity; }' is not assignable to type 'IntrinsicAttributes & ActivityItemProps'. Property 'activity' does not exist on type 'IntrinsicAttributes & ActivityItemProps'.`

## Error classification
- Type: **invalid component props** (component contract mismatch)
- Not observed as:
  - missing named export
  - invalid import path
  - invalid JSX/TSX syntax
  - App Router issue
  - client/server mismatch

## Root cause
- `ActivityFeed` invoked `ActivityItem activity={activity}`.
- Generated `ActivityItemProps` sometimes omitted `activity` (e.g., used `item` only), creating a TS contract mismatch during Next build typecheck.
- This occurred in generated dashboard component contracts, not preview runner/observability logic.
