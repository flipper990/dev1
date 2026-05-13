# Verified Working Auth Flows

All flows below were executed against a real running local stack (web + api + postgres), with runtime result recorded in `.scratch/runtime/auth-runtime-result.json`.

## 1) Sign Up
- Request: `POST /api/auth/signup`
- Verified:
  - `201` success response
  - authenticated session returned
  - auth cookies set (`devteam_access_token`, `devteam_refresh_token`, `devteam_csrf_token`)
  - dev email verification token issued

## 2) Duplicate Account Prevention
- Request: second `POST /api/auth/signup` with same email
- Verified:
  - `409` duplicate email rejection

## 3) Sign In
- Request: `POST /api/auth/signin`
- Verified:
  - invalid password returns `401`
  - valid password returns `200`
  - authenticated session available via `GET /api/auth/session`

## 4) Protected Routes
- Frontend protected route tested: `/overview`
- Verified:
  - anonymous request redirects to `/login?...` (`307`)
  - authenticated request returns `200`
  - after signout, protected route redirects again (`307`)

## 5) Persistent Login / Reload
- Verified:
  - authenticated session stayed valid across repeated protected page requests (reload behavior check)
  - `GET /api/auth/session` returns authenticated user before signout

## 6) Refresh Token Rotation
- Request: `POST /api/auth/refresh` (with CSRF token)
- Verified:
  - request succeeds (`200`)
  - refresh cookie value rotates (old != new)

## 7) Sign Out
- Request: `POST /api/auth/signout`
- Verified:
  - request succeeds (`200`)
  - subsequent `GET /api/auth/session` returns `401`
  - protected route access blocked again

## 8) Forgot Password
- Request: `POST /api/auth/forgot-password`
- Verified:
  - request succeeds (`200`)
  - dev reset token issued

## 9) Reset Password
- Request: `POST /api/auth/reset-password`
- Verified:
  - request succeeds (`200`)
  - old password rejected (`401`)
  - new password accepted (`200`)

## 10) Email Verification
- Request: `POST /api/auth/verify-email/confirm`
- Verified:
  - request succeeds (`200`)
  - DB `email_verified` becomes `true`

## 11) PostgreSQL Persistence
- Verified in DB:
  - `auth_users` row persisted for created user (`count=1`)
  - `auth_refresh_tokens` rows persisted (`count>=1`, observed `4`)
  - verification state persisted (`email_verified=true`)

