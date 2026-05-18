# SYSTEM ARCHITECTURE MAP

Date: 2026-05-18

## Monorepo
- Root tooling: npm workspaces + Turbo.
- Workspaces:
  - `apps/api` (Fastify backend + generation runtime + preview/export).
  - `apps/web` (Next.js app router frontend).
  - `packages/agent-core` (orchestration/agent runtime shared core).
  - `packages/types` (shared contracts/types).

## Apps and Packages

### `apps/web`
- Framework: Next.js app router.
- Route groups/pages include:
  - `/` landing
  - `/workspace`, `/projects`, `/agents`, `/overview`
  - auth flow routes (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/accept-invite`)
  - marketing/docs/pricing/product/waitlist/request-demo/onboarding/workspaces/security/settings/billing/deployments
- Shells/components:
  - Marketing shell, Auth shell, App shell
  - Workspace feature modules, preview UI model, command dock, pipeline rail

### `apps/api`
- Fastify server boot in `src/server.ts` + `src/app.ts`.
- Main domains:
  - `routes/` (api, auth, preview, websocket, llm, versions)
  - `pipeline/` (generation orchestration, QA, contract gates, diagnostics)
  - `agents/` (spec, builder, qa, polish)
  - `preview/` (docker/local runners, manager, validators, probes)
  - `security/` (auth guards, tokens, cookies, password hashing)
  - `storage/` (project persistence)
  - `runtime/` (db preflight/env loading)
  - `testing/` (E2E harnesses + many runtime artifacts)

### `packages/agent-core`
- Core orchestration and agent abstractions:
  - orchestrator, step executor, step validator, registry, input builder, dependency validator, import integrity, memory abstractions.

### `packages/types`
- Shared TS contracts between API and web.

## Runtime Services
- API service (port 3003 default).
- Web service (port 3000 default).
- PostgreSQL (docker-compose dev).
- Optional Docker engine dependency for preview builds/runs.

## Data Flow
1. Web sends mission create request to API.
2. API reserves project/session, persists placeholder state, returns async response.
3. Generation pipeline executes in API process, updates session progress and project state.
4. Web polls REST + subscribes websocket for real-time status.
5. Preview manager prepares runtime (docker or local), tracks probe/step logs, exposes status/proxy endpoints.
6. Export endpoint streams ZIP from persisted generated files.

## Execution Flow
- Mission lifecycle:
  - Create -> `generating` placeholder -> pipeline run -> terminal state (`generated` or `failed`) -> optional preview/export.
- Session lifecycle:
  - Active progress snapshots + watchdog sweeps + terminal completion/failure events.

## API Surface (Major)
- Health/runtime:
  - `GET /health`
  - `GET /api/runtime/preflight`
  - `GET /api/runtime/metrics`
- Projects:
  - `POST /api/projects`, `POST /api/projects/generate`
  - `GET /api/projects`, `GET /api/projects/:id`
  - file routes, diagnostics routes, export route
- Sessions:
  - `GET /api/sessions/:id/progress`
  - `GET /api/sessions/active`
- Preview:
  - start/stop/status/validate
  - preview proxy route(s)
- Auth:
  - signup/signin/refresh/signout/session/profile/forgot/reset/verify
- LLM ops:
  - costs/circuit-breaker/provider health/overrides
- Websocket:
  - `/ws/sessions/:id/progress`

## Data Storage and Runtime Directories
- Generated projects: `data/projects` (plus project-store paths).
- Memory: `data/memory`.
- API test runtime outputs: `apps/api/src/testing/*` and `apps/api/data/test-runs/*`.
- Reports: `reports/current` and very large `reports/archive`.

## Preview Runtime
- Manager coordinates preview start/stop/status.
- Supports docker and local fallback paths.
- Performs dependency preflight, build/start probes, and content-health checks.
- Persists lifecycle/probe diagnostics to project metadata/artifacts.

## Export System
- Export route checks project eligibility, sanitizes paths, archives files, and returns streamed ZIP.
- Includes generated source and generated metadata/manifests.

## Auth System
- Global auth hook in Fastify.
- Role and project access guards (`owner/admin/member/viewer` semantics).
- Access + refresh cookie flow plus bearer support.
- CSRF token check for unsafe cookie-authenticated methods.
- Dev bypass mode exists for local development.

## Orchestration System
- Agent pipeline: `spec -> builder -> qa -> polish`.
- Orchestrator is wave/dependency-based via `agent-core`.
- Post-generation integrity gates include dependency/import/contract checks and fallback/recovery paths.
- Known risk: degraded fallback paths can produce nominal success with reduced feature fidelity.

## Architectural Risks
1. Package boundary leakage through deep relative imports into `packages/agent-core/src/*`.
2. Monolithic runtime files with high coupling.
3. Artifact and diagnostics mixed with source code paths.
4. Security risk in preview proxy header forwarding.
