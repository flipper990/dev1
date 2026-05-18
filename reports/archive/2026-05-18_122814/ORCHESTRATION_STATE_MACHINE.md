# Orchestration State Machine

## Canonical Execution Phases
Implemented explicit phases in runtime session progress:
- `queued`
- `planning`
- `architecting`
- `backend_generation`
- `frontend_generation`
- `verification`
- `preview_build`
- `artifact_packaging`
- `completed`
- `failed`
- `timed_out`
- `provider_unavailable`
- `retrying`

## Deterministic Mapping
Phase transitions are now derived from orchestrator heartbeat/step events and persisted progress updates.

## Observability Surface
Session progress now exposes:
- `executionPhase`
- `providerStatus`
- `retryAttempt`
- `activeWorker`
- `lastHeartbeatAt`
- `timeoutAt`
- `timeoutRemainingMs`
- `failureReason`

These are included in both:
- `GET /api/sessions/:id/progress`
- `WS /ws/sessions/:id/progress`

## Failure Terminal States
Watchdog forces terminal transitions to:
- `failed` (stalled-step / heartbeat-timeout)
- `timed_out` (mission-timeout)
