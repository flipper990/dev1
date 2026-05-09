# Phase 5 Rollout Plan

## Objective
Roll out the redesigned UI progressively with measurable outcomes and immediate rollback controls.

## Flag-gated rollout sequence
1. `ui_redesign_foundations` internal-only (tokens, spacing, motion)
2. `ui_redesign_shell` internal and design QA cohort
3. `ui_redesign_workspace` canary (5%)
4. `ui_redesign_status_system` canary (5%)
5. `ui_redesign_dark_mode` staggered (internal first, then all)

## Internal rollout steps
1. Enable all flags for internal users and QA.
2. Validate route smoke checks and a11y smoke checks.
3. Confirm telemetry ingestion (event volume and schema correctness).
4. Run canary to 5%, then 25%, then 50%, then 100% if guardrails hold.

## Canary plan
- Cohort: randomized user buckets, stable per user/session.
- Initial window: 48 hours at 5%.
- Expansion criteria: primary metrics improve or remain neutral and guardrails stable.

## Success metrics
- Project creation rate.
- Time to first meaningful project state.
- Time to preview ready.
- Project reopen rate.
- Failure recovery action rate.
- Trust/clarity feedback.

## Guardrails
- JS error rate.
- Contradictory status rate.
- Accessibility violation rate.
- Performance regressions (LCP/INP/CLS).
- Preview retry spikes.
- Support tickets related to confusion.

## Rollback steps
1. Disable `ui_redesign_workspace` and `ui_redesign_status_system`.
2. If needed disable `ui_redesign_shell`.
3. Keep telemetry active to monitor stabilization.
4. Restore prior variant defaults (`legacy-*`) for experiments.

## Legacy to redesign mapping
- Old nav + header -> `AppShell` + `TopBar` + `LeftNav`.
- Old badge fragments -> unified `ProjectStatusSummary` (or legacy row via experiment).
- Old prompt composer -> `ProjectCommandDock` (or legacy fallback via experiment).
- Old agent feed -> `ProductionTimeline` (or legacy feed via experiment).
