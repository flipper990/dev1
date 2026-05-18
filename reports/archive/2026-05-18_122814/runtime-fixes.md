# Runtime Fixes

## Infrastructure and Local Runtime Fixes Applied

1. Added deterministic local runtime verifier script:
- File: `.scratch/runtime/verify-auth-runtime.ps1`
- Purpose:
  - Start PostgreSQL locally (no Docker requirement).
  - Ensure DB role/database (`devteam` / `devteam`) exist.
  - Start API and web runtime processes.
  - Execute real auth flow requests with cookie/session handling.
  - Validate DB persistence and protected route behavior.

2. PostgreSQL bootstrap and connectivity hardening in runtime verification:
- Uses local PostgreSQL binaries from `C:\Program Files\PostgreSQL\18\bin`.
- Waits for readiness via `pg_isready`.
- Auto-fixes missing DB principal and DB:
  - `CREATE ROLE devteam LOGIN` (if missing)
  - `CREATE DATABASE devteam OWNER devteam` (if missing)
  - `ALTER ROLE devteam WITH LOGIN`

3. Local service orchestration fixes:
- API started with explicit runtime env:
  - `DATABASE_URL=postgresql://devteam@127.0.0.1:55432/devteam`
  - `AUTH_TOKEN_SECRET=...`
  - `DEV_AUTH_BYPASS=false`
- Web started in production runtime mode for stable local startup:
  - `npm run build --workspace=@devteam/web`
  - `npm run start --workspace=@devteam/web -- --port 3100`

4. False-success prevention in verification:
- Protected-route checks use `-MaximumRedirection 0` to verify real redirect behavior (not auto-followed 200 pages).
- Refresh-token rotation check compares pre/post refresh cookie values.
- DB checks assert persisted user rows and refresh token rows.

5. Job shutdown ordering fix:
- Runtime script stops jobs in reverse order to avoid API crash noise from DB shutdown order.

