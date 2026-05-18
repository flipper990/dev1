# ENVIRONMENT_LOADING_REPORT

## Loading Paths
API env loading is performed from these candidates (first existing wins per variable unless already set):
- `process.cwd()/.env`
- `process.cwd()/../../.env`
- `apps/api/src/.../../../../.env`

This behavior is used by:
- `apps/api/src/config.ts`
- New runtime scripts via `apps/api/src/runtime/load-env.ts`

## Diagnosed Inconsistencies
1. Missing DB password in `.env` `DATABASE_URL`.
2. `.env.example` did not include a canonical local `DATABASE_URL` for the mission runtime.
3. Compose DB auth and API DB URL were previously weak/inconsistent (`trust` + passwordless URL).
4. Existing service on `3003` may run with different auth settings (`DEV_AUTH_BYPASS=false`), causing `/api/runtime/preflight` 401 for header-only auth.

## Applied Corrections
- `.env`
  - `DATABASE_URL` now includes password and explicit host/port.
  - `HOST=127.0.0.1` for local binding.
- `.env.example`
  - Added `API_PORT`, `HOST`, and canonical `DATABASE_URL`.
- Added `dev1.env.example` with explicit local API/DB/auth defaults.
- `docker-compose.dev.yml`
  - Added `POSTGRES_PASSWORD`.
  - API `DATABASE_URL` now includes password.

## Effective Local Runtime Values
- `API_PORT=3003` (default path; can fallback to 3303 in E2E bootstrap if 3003 is occupied)
- `HOST=127.0.0.1`
- `DATABASE_URL=postgresql://devteam:devteam@127.0.0.1:55432/devteam`

## Result
Env loading and DB runtime variables are now explicit and validated pre-start, preventing silent undefined-password runtime failures.
