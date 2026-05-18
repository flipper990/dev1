# Placeholder Systems Report

## Confirmed Placeholder/Disabled Systems

1. Billing
- UI explicitly states billing backend/provider endpoint missing.
- Plan/invoice management intentionally unavailable.
- Classification: **PLACEHOLDER (intentional)**.

2. Deployments
- Deployment API/history contract missing.
- Page intentionally routes users to export-based handoff.
- Classification: **PLACEHOLDER (intentional)**.

3. Settings persistence
- Settings page marked read-only, persistence contract missing.
- Save/discard intentionally disabled.
- Classification: **PLACEHOLDER (intentional)**.

4. Marketing intake forms (waitlist/request-demo)
- Submission intentionally disabled, “coming soon” backend language present.
- Classification: **PLACEHOLDER (intentional)**.

5. Some auth-adjacent enterprise flows
- SSO/invite/workspace-create-first-project surfaces include explicit “requires endpoint” states.
- Classification: **PLACEHOLDER / PARTIAL**.

## Non-placeholder but currently failing
- Core generation pipeline is not a placeholder; it is implemented but unhealthy in runtime.
- Classification: **BROKEN**, not mocked.
