# Phase 5 Release Checklist

## Pre-release
- [ ] Flags defaulted for safe rollout.
- [ ] Telemetry events validated in staging.
- [ ] Storybook variant coverage reviewed.
- [ ] Visual regression snapshots updated.
- [ ] Accessibility smoke checks run on shell/workspace/projects/activity.
- [ ] Route smoke checks pass with flags on and off.

## Canary
- [ ] 5% canary enabled.
- [ ] Primary metric dashboard live.
- [ ] Guardrail dashboard live.
- [ ] Daily canary review ritual scheduled.

## Rollback-safe checks
- [ ] `ui_redesign_workspace` disable tested.
- [ ] `ui_redesign_status_system` disable tested.
- [ ] `ui_redesign_shell` disable tested.
- [ ] Legacy experiment variants still render.

## Post-release
- [ ] 100% rollout decision documented.
- [ ] Old/new UI mapping archived for support and operations.
- [ ] Final metrics and incidents summarized.
