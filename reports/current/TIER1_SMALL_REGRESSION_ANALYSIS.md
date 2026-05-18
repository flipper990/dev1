# Tier1 Small Regression Analysis

- Timestamp: 2026-05-18 12:53:15 +02:00
- Scope: regression fix + targeted validation + constrained canary (max 5 prompts allowed)

## Checkpoint Before Changes
- `git status --short`: repo already dirty with many pre-existing modified/deleted/untracked files.
- Required artifact files:
  - `apps/api/src/testing/successful-mission-results.json`: present
  - `apps/api/src/testing/last-failure.json`: present
  - `apps/api/src/testing/last-local-preview-failure.json`: present
- Latest failure artifacts observed:
  - `apps/api/src/testing/last-builder-empty-failure.json` (2026-05-18 01:05:00)
  - `apps/api/src/testing/last-failure.json` (2026-05-18 00:11:00)
  - `apps/api/src/testing/last-local-preview-failure.json` (2026-05-17 23:42:47)

## Parallel Agent Findings Merged
- Snapshot crash (`this.snapshotFailure is not a function`) path existed in local preview runner failure writes.
- Tier1 contract already dropped backend files by default, but lacked explicit prompt-intent override wiring.
- Failure classifier had broad Tier1 scope matching that could misclassify some non-policy messages.

## Implementation Outcome
- Snapshot failure path hardened to avoid dependence on instance-bound method calls for snapshot capture.
- Tier1 scope policy updated and wired with backend/full-stack intent override at generation-finalization contract passes.
- Failure classification tightened to preserve distinct categories and reduce broad overclassification.
- Targeted tests passed (see `TARGETED_TEST_RESULTS.md`).
- Canary-1 executed but failed due runtime environment/file-write issue before mission completion (see `CANARY_1_RESULT.md`).

## Current Status
- Regression code fixes and targeted unit/contract validations: completed.
- Tier1 canary sequence progression: stopped after Canary-1 failure (per guardrail; no 3/5 execution).
