# Root QA Gate Fix Report

## Problem
Root `npm run test` and `npm run type-check` were false-green because Turbo included `<NONEXISTENT>` workspace tasks.

## Fixes Implemented

### Workspace script normalization
- `apps/api/package.json`
  - added `test`
  - added `type-check` alias to real typecheck
- `apps/web/package.json`
  - added `test`
  - added `type-check`
- `packages/agent-core/package.json`
  - added `build`, `type-check`, `test`
- `packages/types/package.json`
  - added `test`

### Root/Turbo verification
- `npx turbo run test --dry=json` -> no `<NONEXISTENT>` tasks
- `npx turbo run type-check --dry=json` -> no `<NONEXISTENT>` tasks
- Explicit checks confirmed:
  - `NO_NONEXISTENT_TASKS_IN_TEST`
  - `NO_NONEXISTENT_TASKS_IN_TYPECHECK`

## Result
Root test/type-check gates now map to real workspace commands and are no longer false-green by missing-task drift.
