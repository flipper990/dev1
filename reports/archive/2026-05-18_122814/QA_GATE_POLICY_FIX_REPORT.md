# QA Gate Policy Fix Report

## Implemented changes

### 1. New Tier 1 QA decision policy
- Added: `apps/api/src/pipeline/qa-gate-policy.ts`
- Function: `evaluateQaGateDecision(report, { tier: 'tier1', pipelineCompleted, minScore })`
- Tier 1 decision rules:
  - fail if pipeline not completed
  - fail if blockers > 0
  - fail if score < threshold (default 95)
  - pass otherwise
- Reason string now includes explicit score/threshold and blocker/error/warning counts.

### 2. Applied policy in generation/update finalization
- Updated: `apps/api/src/pipeline/project-generator.ts`
- Updated: `apps/api/src/pipeline/project-updater.ts`
- Replaced raw `qa.report.passed` hard-fail gating with policy result.

### 3. Fixed false-positive backend-route detection in QA
- Updated: `apps/api/src/pipeline/quality-assurance.ts`
- `checkFunctionalE2E` now recognizes Next App Router and pages API route handlers:
  - `export async function GET|POST|PUT|PATCH|DELETE`
  - `export const GET|POST|... = ...`
- Derives route paths from file paths:
  - `src/app/api/**/route.ts(x)` -> `/api/**`
  - `src/pages/api/**` -> `/api/**`

## Why this fixes 96/100 no-blocker failures
- Those missions failed due QA `functional-e2e` error false positives, then finalizer hard-failed on `qa.report.passed=false`.
- New route detection removes that false-positive class.
- New policy ensures Tier 1 no-blocker high-score missions pass (>=95).

## Tests added
- `apps/api/src/pipeline/qa-gate-policy.test.ts`
  - 96/100 + no blockers passes
  - below threshold fails
  - blockers always fail
  - warnings alone do not fail Tier 1
  - explicit reason text asserted
- `apps/api/src/pipeline/quality-assurance.test.ts`
  - Next route handlers count as backend routes
  - backend-without-routes still fails

## Measured effect in rerun
- Previous QA-gate 96/no-blocker failures: 2
- Current QA-gate failures: 0
