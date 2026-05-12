# Phase 5 Telemetry Schema

## Event names
- `ui_variant_exposed`
- `shell_loaded`
- `project_opened`
- `workspace_status_viewed`
- `preview_opened`
- `preview_retry_clicked`
- `build_timeline_opened`
- `command_submitted`
- `empty_state_action_clicked`
- `keyboard_navigation_detected`

## Common properties
- `route`
- `theme`
- `variant`
- `project_stage`
- `preview_state`
- `health_state`
- `action_source`
- `retry_count`
- `lcp_ms`
- `inp_ms`
- `cls`

## Noise control rules
- Track only meaningful user/system events.
- Avoid repeated high-frequency events on same action.
- Sanitize payloads to remove empty fields.

## Implementation files
- `apps/web/src/lib/telemetry/events.ts`
- `apps/web/src/lib/telemetry/useTrackEvent.ts`
- `apps/web/src/lib/telemetry/localTracker.ts`
- `apps/web/src/lib/telemetry/routeMetrics.ts`

## Current ingestion status
- Frontend sends to `/api/telemetry/events` only when `NEXT_PUBLIC_TELEMETRY_ENABLED=1` or `true`.
- Backend ingestion route is currently not implemented, so telemetry is disabled by default and remains local-only.
