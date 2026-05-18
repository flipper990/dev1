# Runtime Reliability Report

## Scope
This audit and fix pass focused only on mission runtime reliability, orchestration integrity, and deadlock prevention.

## Implemented
- Added strict runtime preflight gate before mission launch (`/api/projects`, `/api/projects/generate`).
- Added provider health preflight with required-model-provider validation and detailed diagnostics.
- Added runtime preflight endpoint: `GET /api/runtime/preflight`.
- Added detailed provider health endpoint: `GET /api/llm/providers/health/detailed`.
- Hardened session runtime state with explicit execution phases and heartbeat metadata.
- Added watchdog sweeps for mission timeout, stalled step, and heartbeat timeout.
- Added automatic session-to-project failover persistence when watchdog trips.
- Exposed observability fields on REST + WebSocket progress payloads.

## Reliability Outcome
- Mission launch is now blocked when required providers are unavailable or unhealthy.
- Active sessions are no longer allowed to remain active indefinitely without heartbeats/progress.
- Timed out/stalled runs are forced into terminal failure with actionable diagnostic strings.

## Verification
- `npm run build --workspace=@devteam/api` passed.
- `npm run build --workspace=@devteam/web` passed.
- `npm run test:contracts --workspace=@devteam/api` passed.
- New runtime reliability tests passed:
  - `apps/api/src/pipeline/session-manager.test.ts`
  - `apps/api/src/llm/provider-registry.test.ts`

## Remaining Risk
- Full real-world mission success still depends on valid provider credentials/quota and model compatibility.
- Preflight now blocks known bad starts, but provider can still degrade mid-run; watchdog covers this with deterministic failure instead of deadlock.
