# Required Fixes Priority

## P0 (Immediate)

1. Fix generation deadlock at `Specification`
- Add hard timeout and fail transition for stalled `runReserved` phase.
- Ensure session/project state flips from `active/generating` to actionable failed state.

2. Restore LLM provider health
- Correct provider configuration and credential/runtime path until `/api/llm/providers/health` reports healthy.
- Add startup hard-fail or degraded-mode banner when no provider is healthy.

3. Prevent “active forever” sessions
- Add watchdog sweeper for stale active sessions with terminal status + reason.

## P1 (High)

4. Preflight mission readiness checks in UI/API
- Block or warn mission launch if provider health is false.
- Return explicit `UNAVAILABLE_PROVIDER` errors early.

5. Preview fallback strategy for incomplete generation
- If no files exist, present deterministic recovery instructions and CTA to retry/fix generation.

6. Mission diagnostics clarity
- Surface exact stuck phase and remediation in workspace status area.

## P2 (Medium)

7. Placeholder surface governance
- Hide or feature-flag billing/deploy/settings persistence actions by environment/plan.

8. Expand runtime E2E regression suite
- Add automated mission completion test asserting a real successful generation artifact path.

## Completed During This Audit
- Fixed `route-smoke.mjs` auth bootstrap and marker checks.
- Fixed `rollback-smoke.mjs` auth bootstrap and stale markers.
- Fixed `visual-regression-smoke.mjs` ESM import issue.
