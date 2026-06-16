# Logout Button Prop Fix Report

## Objective
Prevent generated logout UI from failing when `LogoutButton` is used without required callback props.

## Deterministic strategy selected
- Option A (safe self-contained callback contract) for preview-safe UI callbacks.
- Rule: if a required callback prop is missing at usage and matches safe callback shape, convert it to optional in the component contract.

## Implemented behavior
- In deterministic contract pass:
  - detect `<Component />` usage missing required props
  - if missing prop is a safe callback (`onX` with callback type), repair component prop contract to optional
  - keep deterministic diagnostics record with repair result

## Code touched
- `apps/api/src/pipeline/deterministic-generation-contract.ts`
- `apps/api/src/pipeline/deterministic-generation-contract.test.ts`

## Targeted tests proving fix
- `deterministic contract repairs missing required callback props by making preview-safe callback optional`
  - verifies `onLogout: () => void` becomes `onLogout?: () => void`
  - verifies no blocking mismatch is emitted for this recoverable case
- `deterministic contract fails unrecoverable required non-callback props with component mismatch diagnostics`
  - ensures strict fail for non-safe required props

## Notes from latest one-prompt rerun
- Project: `ZEUh0nPxYChu`, session: `X2yE_dXuYCfnSmz4`.
- Final output for this run did not include `src/app/logout/page.tsx` in the emitted preview runtime tree.
- Therefore, direct runtime observation of `LogoutButtonProps` repair in this specific rerun artifact is not applicable.
- The deterministic tests and validator coverage are the verification source for the repaired class behavior.
