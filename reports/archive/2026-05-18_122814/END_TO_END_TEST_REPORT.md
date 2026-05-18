# End-to-End Test Report

## Runtime Setup
- API health check: `200`
- Web root: `200`
- Dev auth bypass: `false` (real auth enforced)

## Auth Flow Tests
1. `POST /api/auth/signup` with weak password -> `400` (validation works)
2. `POST /api/auth/signup` valid -> authenticated true, auth cookies issued
3. `GET /api/auth/session` after signup -> authenticated true
4. `POST /api/auth/refresh` with CSRF header -> success
5. `POST /api/auth/signout` with rotated CSRF token -> success
6. `GET /api/auth/session` after signout -> `401`
7. `POST /api/auth/signin` wrong password -> `401`
8. `POST /api/auth/signin` correct password -> success

Result: **Auth backend works end-to-end**.

## Route Protection Tests
- Unauthenticated `/workspace` -> `307` redirect to login
- Authenticated route access works with shared localhost cookies

Result: **Protected-route middleware works**.

## Project Flow Tests
1. `POST /api/projects` returns `202`, projectId + sessionId
2. `GET /api/projects` shows created project
3. `GET /api/projects/:id` returns project state
4. `DELETE /api/projects/:id` works, subsequent get returns `404`

Result: **Project API lifecycle is functional**, but generation state may remain unresolved.

## Mission / Generation Flow Tests
Executed multiple real missions with prompts.

Observed behavior:
- Session progress repeatedly stuck:
  - status: `active`
  - progress: `0`
  - current step: `Specification`
  - persisted for 60-120 seconds+ with no transition
- Project state remains:
  - `status=generating`
  - `verificationStatus=pending`
  - `previewStatus=idle`
- Runtime debug endpoint shows active generations stuck in `phase=init`, `step=runReserved`
- LLM provider health endpoint reports:
  - `openai=false`

Result: **Core generation mission is broken in this runtime**.

## Preview / Evidence / Export
- `POST /api/projects/:id/preview/start` on stalled mission -> `502` with explicit message:
  - “Project <id> has no files to preview.”
- `GET /api/projects/:id/export` during generating -> `409` (expected gate)
- Sessions endpoint:
  - `/api/sessions/active` includes active session IDs

Result: Preview/export gates are real, but blocked by generation failure.

## Smoke/Audit Script Execution
- `test:smoke:a11y` -> pass
- `test:smoke:routes` -> initially failed, fixed, now pass
- `test:smoke:rollback` -> initially failed, fixed, now pass
- `test:smoke:visual` -> initially broken (`require` in ESM), fixed, now pass

## E2E Conclusion
The full workflow **breaks at generation execution**. Everything around it (auth, routing, APIs, guards, status surfaces) mostly works, but the mission cannot complete to usable artifacts.
