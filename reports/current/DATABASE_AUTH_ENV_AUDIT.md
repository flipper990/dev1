# DATABASE AUTH ENV AUDIT

Date: 2026-05-18

## Scope
- PostgreSQL usage/migrations
- auth implementation
- session/cookie/CSRF
- env loading and docker/local runtime setup

## Database Reality
- DB preflight passed in subagent run (url/tcp/auth/database/migrations OK).
- Runtime DB usage is focused around auth store + preflight checks.
- Auth schema migrations are applied from auth-store path at startup.

## Migration Risks
1. Two migration sources exist (inline auth migrations and SQL migration file), creating drift risk.
2. Token cleanup function exists but is not clearly scheduled in app lifecycle.

## Auth Reality
- Signed token format + refresh/reset/verify token flows are implemented.
- Password hashing uses modern primitive (`scrypt`) with timing-safe compare.
- Role/project access checks and auth guards are present across route surface.

## Cookie/CSRF Reality
- Access/refresh/csrf cookie patterns are implemented.
- CSRF double-submit logic exists for unsafe cookie-authenticated methods.
- Additional origin/referer hardening is limited.

## Env and Runtime Risks
1. Env loading has multiple paths and some config drift potential.
2. `STORAGE_PATH` appears documented but runtime primarily consumes `PROJECTS_DIR`/`MEMORY_DIR`.
3. Dev bypass (`DEV_AUTH_BYPASS`) is useful for local but must remain tightly controlled in prod.
4. One subagent could not fully validate docker daemon state due local permission issue.

## Status Summary
- DB/auth baseline: Real.
- Config/migration hygiene: Partial.
- Production-hardening completeness: Partial.
