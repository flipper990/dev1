# P0 Stabilization Report

Date: 2026-05-18
Scope: P0 blockers only (security, persistence, truthful gates, API lint/build)

## Outcome Summary

1. Preview proxy security issue: **Fixed**
- Proxy now strips auth/session/CSRF/internal identity headers before forwarding to preview runtimes.
- Added explicit security test proving sensitive headers are not forwarded.

2. EPERM project persistence issue: **Fixed in storage layer + failure propagation hardened**
- Added Windows-safe retry wrappers for mkdir/write paths used by project persistence.
- Atomic JSON write path now retries temp-file write stage (EPERM/EBUSY retry class).
- Reservation-time persistence failures now return classified code (`FILESYSTEM_PERMISSION_FAILURE` vs `PROJECT_PERSISTENCE_FAILURE`).
- Session progress no longer disappears on reservation-time persistence failure.

3. Root test/type-check false green: **Fixed**
- Workspace scripts were normalized so Turbo task graph maps to real commands.
- Root dry checks now show no `<NONEXISTENT>` tasks for `test` or `type-check`.

4. API lint/build health: **Fixed**
- Restored API lint wiring with ESLint v9 flat config and dependencies.
- API build and typecheck are green.
- API lint command executes successfully (current output is warnings only, no errors).

5. Canary requirement: **Executed (Canary 1 only) and failed**
- Canary 1 failed in generated app preview/build with `generated_typescript_error`.
- No EPERM persistence failure observed in this run.
- Because Canary 1 failed, 3-prompt run was correctly not executed.

## Files Changed (P0 scope)
- `apps/api/src/routes/preview-routes.ts`
- `apps/api/src/routes/preview-routes.security.test.ts`
- `apps/api/src/storage/project-store.ts`
- `apps/api/src/routes/api.ts`
- `apps/api/src/pipeline/session-manager.ts`
- `apps/api/src/pipeline/session-manager.test.ts`
- `apps/api/src/pipeline/project-updater.ts`
- `apps/api/src/pipeline/terminal-state-consistency.test.ts`
- `apps/api/src/preview/preview-manager.ts`
- `apps/api/package.json`
- `apps/api/eslint.config.mjs`
- `apps/web/package.json`
- `packages/agent-core/package.json`
- `packages/types/package.json`
- `package-lock.json`

## Validation Status
- Targeted checks: completed.
- Canary 1: completed, failed for generated app TS/build errors (non-persistence).
