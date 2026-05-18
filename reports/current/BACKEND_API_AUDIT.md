# BACKEND API AUDIT

Date: 2026-05-18

## Scope
- Fastify API routing and middleware
- auth, projects, sessions, preview/export, runtime endpoints
- error handling and validation

## Architecture Reality
- Modular route registration in `app.ts` with domain-specific route files.
- Global auth hook + role/project access guards are in place.
- API surface is comprehensive for mission lifecycle, diagnostics, preview, export, and auth.

## Strengths
1. Route domains are reasonably separated (`api`, `auth`, `preview`, `websocket`, `llm`, `version`).
2. Error handling includes global handler and defensive per-route catches.
3. Role-based and project-scoped access checks are consistently applied on key routes.
4. Targeted auth/contracts tests passed in subagent run.

## Key Risks / Defects
1. High: preview proxy header forwarding currently leaks user auth headers/cookies to generated app runtime.
2. Medium: `preview/validate` body path has weak schema enforcement and potential `NaN` coercion behavior.
3. Medium: auth rate limiter is in-memory and not centrally durable/scalable.
4. Medium: API build/lint quality gates currently not green, reducing deploy confidence.

## Validation/Observability
- Runtime preflight and metrics routes exist.
- Diagnostics and pipeline ledger routes provide deep visibility.

## Status Summary
- Backend feature coverage: Real.
- Backend security hardening completeness: Partial.
- Backend release gate health: Broken at present due lint/build issues.
