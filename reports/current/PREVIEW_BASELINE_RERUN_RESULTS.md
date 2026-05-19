# Preview Baseline Rerun Results

## Run constraints followed
- Ran exactly these 3 prompts only:
  1. `Build a simple landing page with hero section, features, and CTA.`
  2. `Build a simple SaaS dashboard with sidebar, KPI cards, and recent activity.`
  3. `Build a simple pricing page with three plans and feature comparison.`

## Latest rerun summary
- Source: `apps/api/src/testing/successful-mission-results.json`
- `startedAt`: 2026-05-19T19:19:08.986Z
- `completedAt`: 2026-05-19T19:43:23.477Z
- Total: 3
- Passed: 2
- Failed: 1
- Success rate: 66.67%

## Per prompt outcome
- Landing page: **PASS** (`projectId=pCSFQCln7w5A`)
- SaaS dashboard: **FAIL** (`projectId=QRAmPAcgGUzv`)
- Pricing page: **PASS** (`projectId=6zMqH3LZCaeA`)

## Current remaining failure (post-fix)
- Category: `dependency_failure`
- Phase: `slice-4/7`
- Reason:
  - `[artifact-integrity] ... INVALID_PACKAGE_JSON: package.json failed validation (strict-react-next-bundle-pins)`
- This is **not** the prior generated TypeScript preview build error.

## Key conclusion
- Original generated TypeScript failure class was removed from this 3-prompt baseline path.
- Residual failure now belongs to dependency/package manifest validation and should be handled in a separate dependency reliability pass.
