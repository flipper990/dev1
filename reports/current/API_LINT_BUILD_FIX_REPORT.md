# API Lint/Build Fix Report

## Problem
API lint command was broken (`eslint` missing). API build/typecheck had active TypeScript failures.

## Fixes Implemented

### ESLint wiring restored
In `apps/api/package.json` + new `apps/api/eslint.config.mjs`:
- Added dependencies:
  - `eslint`
  - `@eslint/js`
  - `typescript-eslint`
- Added flat-config ESLint v9 configuration.
- `npm run lint --workspace=@devteam/api` now executes successfully.

### TypeScript build fixes
Resolved blocking compile errors in:
- `apps/api/src/pipeline/terminal-state-consistency.test.ts`
- `apps/api/src/storage/project-store.ts`
- `apps/api/src/pipeline/project-updater.ts`
- `apps/api/src/preview/preview-manager.ts`
- `apps/api/src/storage/project-store.ts` failure category union widened to match classifier categories.

## Validation
- `npm run lint --workspace=@devteam/api` -> PASS (warnings only)
- `npm run typecheck --workspace=@devteam/api` -> PASS
- `npm run build --workspace=@devteam/api` -> PASS

## Current Residual
API lint currently reports warnings (legacy code quality debt), but no errors.
