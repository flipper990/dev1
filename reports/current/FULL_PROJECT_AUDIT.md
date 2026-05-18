# FULL PROJECT AUDIT

Date: 2026-05-18
Scope: Complete read-only audit of monorepo. No source files modified.

## Agents Used (Parallel)
1. Architecture Agent: monorepo boundaries, runtime services, data/execution flow.
2. Frontend/UI Agent: Next.js routes/shells/components/UX quality.
3. Backend/API Agent: Fastify routes, auth, validation, error handling.
4. Generation Runtime Agent: orchestration, contracts, fallback, integrity gates.
5. Preview/Export Agent: preview runners, proxy, export path.
6. Database/Auth/Env Agent: Postgres, migrations, auth/cookies/CSRF/env.
7. Testing/QA Agent: test wiring, smoke/E2E harnesses, gate truth.
8. Cleanup/Tech Debt Agent: clutter, stale artifacts, naming/folder debt.

## 1. Project Summary
DEVteam is an internal AI application-generation platform. A user submits a natural-language prompt, then a multi-agent backend (`spec -> builder -> qa -> polish`) generates a fullstack project, stores artifacts, provides preview runtime, and supports export ZIP delivery. Primary audience is internal product/engineering teams validating prompt-to-app generation workflows.

Category: AI-assisted fullstack generation platform with runtime preview and export pipeline.

Main workflow:
1. User creates mission from web app.
2. API reserves project/session and runs async generation pipeline.
3. Session progress streams over websocket.
4. Generated project is persisted, preview can be started, export can be downloaded.

## 2. System Map
Detailed map is in `SYSTEM_ARCHITECTURE_MAP.md`.

## 3. What Works (Reality)
Detailed matrix is in `FEATURE_REALITY_MATRIX.md`.
High confidence working areas:
- Core Fastify app boot and route registration.
- Auth route suite basics (signup/signin/refresh/signout/session/profile) with passing targeted tests.
- Project/session route surface exists and is wired.
- Generation pipeline core path exists with multiple integrity/contract checks.
- Preview and export subsystems exist and are operationally integrated.

## 4. What Does Not Work / Regressions
Key broken/unstable areas:
- Root QA gates are misleading (`test` and `type-check` do not execute most workspace tests/typechecks).
- API lint/build currently red (`eslint` missing in API workspace lint path; API TS build errors reported by QA agent).
- Reliability evidence is inconsistent across reports/reruns; canary currently failed from EPERM project persistence.
- Frontend has visible dead/placeholder paths and dead-end controls.
- Preview proxy currently forwards user auth headers/cookies upstream to generated app runtime (security risk).

## 5. Code Quality Audit
Strengths:
- Clear app split (`apps/api`, `apps/web`) and strong domain partitioning in API (`routes`, `pipeline`, `preview`, `security`, `storage`).
- Rich observability artifacts and explicit generation diagnostics.
- Broad defensive logic around generation integrity, validation, and failure categorization.

Weaknesses:
- Over-complex, very large runtime modules (`project-generator.ts`, `preview-manager.ts`, `generation-runner.ts`) with mixed concerns.
- Package boundary leakage: API imports `packages/agent-core/src/*` internals through deep relative paths.
- Web has mixed roots (`apps/web/components` and `apps/web/src/components`) causing navigation and ownership friction.
- Placeholder/dead UX patterns are mixed with production-facing routes.
- Runtime artifacts and test dumps are mixed inside source tree (`apps/api/src/testing`).

## 6. Technical Debt Audit
High debt clusters:
- Artifact sprawl: `reports/` and `apps/api/src/testing`/`apps/api/data/test-runs` contain heavy historical output.
- Workaround paths remain in preview local-runner (`--legacy-peer-deps` fallback).
- Duplicate/ambiguous env templates and stale legacy folders.
- Reliability docs are numerous and sometimes contradictory without a single source of truth.

Details are in `TECHNICAL_DEBT_AND_CLEANUP_PLAN.md`.

## 7. Cleanup Plan (No Deletion Executed)
Detailed plan in `TECHNICAL_DEBT_AND_CLEANUP_PLAN.md`.

## 8. Reliability Status
Observed history from project artifacts:
- Historical tier data indicates Tier 1 hit 9/10 in a past stabilized run.
- Later reruns regressed (7/10, and archived 3/10 decisions also exist).
- Latest current canary failed with EPERM mkdir under `data/projects`, then project 404/session 403 timeout.
- Current reliability state is uncertain until a clean bounded rerun produces one authoritative result set.

## 9. Production Readiness
Decision: Not production-ready. Current state is internal alpha.
Rationale: reliability instability, misleading gate wiring, active API lint/build issues, security risk in preview proxy header forwarding, and significant operational debt.

## 10. Priority Fix List
Detailed roadmap is in `PRIORITY_FIX_ROADMAP.md`.

## Commands Run (Consolidated)
Representative commands used across lead + subagents:
- Repo inventory: `Get-ChildItem`, `rg --files`, targeted `Get-Content` reads.
- Route/flow tracing: `rg -n` across API/web/pipeline/preview/security modules.
- QA checks (from subagents):
  - `npm run test:auth --workspace=@devteam/api`
  - `npm run test:contracts --workspace=@devteam/api`
  - `npm --workspace @devteam/api run db:preflight`
  - `npm run test`, `npm run lint`, `npm run type-check`, `npm run build`
  - `npx turbo run test|lint|type-check --dry=json`

## Remaining Blockers
1. Reliable canary execution blocked by EPERM/project persistence behavior.
2. Gate truth is unreliable until root task wiring is corrected.
3. Docker runtime status could not be fully validated by one subagent due local daemon permission constraints.

## What To Keep vs Refactor
Keep:
- Core monorepo split and route/service decomposition.
- Multi-agent orchestration concept and integrity-first philosophy.
- Preview/export functional architecture.

Refactor first:
- Gate wiring and CI truth.
- Oversized runtime modules.
- Artifact storage boundaries.
- Security posture around preview proxy header forwarding.
