# Route-Level Smoke Tests For Flagged UI

## Purpose
Validate route availability and core rendering under both redesign-enabled and redesign-disabled states.

## Command
- `npm run test:smoke:routes`

## Covered routes
- `/`
- `/projects`
- `/workspace`
- `/agents`

## Variants
- `ui_redesign_shell=1&ui_redesign_workspace=1&ui_redesign_status_system=1`
- `ui_redesign_shell=0&ui_redesign_workspace=0&ui_redesign_status_system=0`

## Failure criteria
- Non-2xx response.
- Missing base page markers.
