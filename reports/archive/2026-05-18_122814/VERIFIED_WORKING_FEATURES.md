# Verified Working Features

## Authentication and Session
- Signup validation and account creation
- Signin credential validation
- Session retrieval endpoint
- Refresh endpoint with CSRF enforcement
- Signout with CSRF enforcement
- Unauthorized responses for missing/invalid auth

## Route Security
- Protected pages redirect when unauthenticated
- Authenticated cookies allow protected route access

## Project APIs
- Mission creation endpoint responds with projectId/sessionId
- Project list/get/delete endpoints work
- Ownership/workspace guards enforced

## Session/Runtime Observability
- Active session listing works
- Session progress endpoint works
- Runtime debug endpoint (`/debug/runtime`) reports live in-process state

## Preview/Export Guardrails
- Preview status/start/stop endpoints respond with structured errors/success states
- Export endpoint correctly blocks non-generated projects (`409`)

## QA Tooling (after fixes in this audit)
- Route smoke script passes
- Rollback smoke script passes
- Visual regression smoke script runs and produces hashes
- A11y smoke script passes
