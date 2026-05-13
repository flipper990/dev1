# Local Runtime Report

## Execution Timestamp
- 2026-05-13T00:08:34+02:00 (Europe/Stockholm)

## Runtime Environment Used
- Frontend: Next.js (`@devteam/web`) on `http://127.0.0.1:3100` (production start mode: `next build` + `next start`).
- Backend: Fastify API (`@devteam/api`) on `http://127.0.0.1:3003`.
- Database: PostgreSQL 18 local process on `127.0.0.1:55432` using data dir `.scratch/pg-auth-data2`.
- DB URL used by backend: `postgresql://devteam@127.0.0.1:55432/devteam`.

## Service Startup Verification
- PostgreSQL started successfully and accepted connections on `55432`.
- API started successfully and passed health checks on `/health`.
- Web app built and started successfully on port `3100`.

## End-to-End Auth Runtime Result
- Source: `.scratch/runtime/auth-runtime-result.json`
- Status: `AUTH_RUNTIME_STATUS=PASS`
- Verified checks:
  - `anonymous_protected_route_redirect`
  - `signup_success`
  - `auth_cookie_creation`
  - `duplicate_email_rejected`
  - `invalid_password_rejected`
  - `signin_success`
  - `session_endpoint_success`
  - `protected_route_allows_authenticated`
  - `session_persists_after_reload`
  - `refresh_token_rotation`
  - `email_verification_confirm`
  - `forgot_password_success`
  - `reset_password_success`
  - `old_password_rejected_after_reset`
  - `signin_with_new_password_success`
  - `signout_success`
  - `signed_out_session_invalid`
  - `protected_route_redirect_after_signout`
  - `database_persistence_verified`

## Database Persistence Verification
- `auth_users` rows for created runtime test user: `1`.
- `email_verified` after verification flow: `true`.
- `auth_refresh_tokens` rows for created user: `4`.

