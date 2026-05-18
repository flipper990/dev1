# Provider Health Report

## Implemented
- Extended provider registry with detailed health status:
  - `healthy`
  - `reason`
  - `checkedAt`
  - `latencyMs`
- Added timeout-bound provider health checks to prevent hanging health probes.
- Added provider preflight API in registry to validate required providers before launch.
- Launch flow now enforces preflight and returns `503 RUNTIME_PREFLIGHT_FAILED` when unhealthy.

## New Endpoints
- `GET /api/llm/providers/health` (boolean map, existing)
- `GET /api/llm/providers/health/detailed` (new detailed map)
- `GET /api/runtime/preflight` (new launch-readiness check)

## Launch Blocking Behavior
Mission creation is blocked when:
- Any model-required provider is not registered.
- Any model-required provider health check fails.
- Storage or preview runtime preflight checks fail.

## Verified
- Provider preflight unit tests pass (`provider-registry.test.ts`).
