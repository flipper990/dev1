# Phase 4 System States

## Objective
Make difficult system states understandable and actionable without drama.

## Priority states
- Build failed
- Preview starting
- Preview failed
- Stale or out-of-sync
- Verification pending
- Launch ready

## UI patterns
- `SystemBanner` for high-level system state.
- `InlineStatusPanel` for local failure context.
- `RecoveryActions` for immediate next steps.
- `SyncWarningPanel` for contradictory state reconciliation.
- `VerificationSummary` and `LaunchChecklist` for readiness visibility.

## Core question flow
Every critical state answer must include:
1. What failed.
2. Where it failed.
3. What still worked.
4. What to do next.

## Trust posture
- Calm language.
- No terminal theatrics.
- Evidence and actions shown together.
