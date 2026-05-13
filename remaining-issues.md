# Remaining Issues

## Blocking Issues
- None for local end-to-end authentication runtime. The verified runtime auth flow passed.

## Non-Blocking Issues

1. Next.js middleware deprecation warning
- Current warning during web build/start: middleware convention is deprecated in favor of `proxy`.
- Impact: non-blocking right now; auth route protection still works.
- Recommended follow-up: migrate `apps/web/middleware.ts` to `apps/web/proxy.ts`.

2. Multiple lockfile warning in web build/start
- Next.js warns about multiple lockfiles (`repo root` and `apps/web`).
- Impact: non-blocking; app runs.
- Recommended follow-up: standardize lockfile strategy or set explicit Next root/output tracing config.

3. Docker is unavailable in this environment
- Auth runtime is fully validated without Docker by using local PostgreSQL process startup.
- Impact: non-blocking for auth system; only relevant for docker-dependent preview paths.

4. Local PostgreSQL scratch cluster uses role `devteam` (not `postgres`)
- Startup logs include expected failed probes for non-existent roles during admin-user detection.
- Impact: non-blocking; DB auth flow and persistence are working.

