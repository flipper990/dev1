# Phase 4 Error Recovery

## Recovery model
- Announce issue with a concise banner.
- Show localized context panel with failure detail.
- Offer explicit, ordered actions: retry, inspect evidence, diagnostics.
- Preserve successful work and state this clearly.

## Patterns implemented
- `SystemBanner` for state announcements.
- `InlineStatusPanel` for failure decomposition.
- `RecoveryActions` for predictable command set.
- `Modal` for focused recovery diagnostics and confirmation.
- `Toast` for progressive retry feedback.

## Retry behavior
- Retry action uses non-blocking feedback (`retrying` toast).
- Logs remain available while retry is in progress.
- Recovery copy avoids blame and keeps clear next actions.

## Evidence-first diagnostics
- `LogEvidenceView` groups entries by step.
- Each entry carries severity, timestamp, and contextual next action.
