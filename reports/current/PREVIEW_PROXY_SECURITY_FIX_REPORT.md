# Preview Proxy Security Fix Report

## Problem
Preview reverse proxy was forwarding inbound auth/session/security headers from the platform to generated preview apps.

## Fix Implemented
Updated `apps/api/src/routes/preview-routes.ts` proxy header forwarding logic:
- Strip `authorization`
- Strip `cookie`
- Strip `x-csrf-token`
- Strip internal identity headers:
  - `x-devteam-user-id`
  - `x-devteam-user-email`
  - `x-devteam-workspace-id`
  - `x-devteam-role`
- Strip sensitive network-forward headers:
  - `x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`, `forwarded`, `via`, `x-real-ip`
- Strip internal prefixes:
  - `x-devteam-*`, `x-internal-*`, `x-forwarded-*`
- Forward only safe preview headers (allowlist + safe browser prefixes like `sec-fetch-*`, `sec-ch-*`, `x-preview-*`).

## Test Coverage Added
New test file:
- `apps/api/src/routes/preview-routes.security.test.ts`

Test proves:
- Sensitive headers are not forwarded upstream.
- Safe headers (`accept`, `x-preview-client`) are forwarded.

## Validation Command
- `npm run test:preview:security --workspace=@devteam/api`
- Result: PASS
