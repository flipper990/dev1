# DEVteam

**A multi-agent AI platform that turns a one-line prompt into a runnable fullstack application — with a live preview, a strict design system, and a production-ready export.**

DEVteam is a 4-agent pipeline (`spec → builder → qa → polish`) with a QA→builder loop that refuses to ship low-quality output. Every agent returns strict JSON validated against a declared schema and cross-step invariants; deterministic auto-repair fills gaps in-place. The generated UI is anchored to an injected design-system contract so output looks consistent across runs.

> One prompt in. A reviewed, gated, polished, runnable repository out.

---

## Why DEVteam is different

| Most AI code tools                            | DEVteam                                                                                                                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single model, one shot                        | 4 specialised agents (`spec`, `builder`, `qa`, `polish`), each with its own model, memory, and validation contract                                                                                                               |
| "Looks right" output                          | Strict JSON output validated against schemas + cross-step invariants; deterministic repair before any artifact enters state                                                                                                      |
| No safety net                                 | QA→Builder loop driven by a mechanical static-check preflight (broken images, dead buttons, missing sidebars, unsubmittable forms, runtime risk) plus an LLM review — verdict is auto-downgraded if criticals remain unaddressed |
| Inconsistent UI                               | Every project gets the same injected design system: 21 semantic CSS-var tokens, 16 primitives (Button → Dialog → Toast), `AppShell` layout, and a class-rewriting sanitizer that fixes invented Tailwind tokens                  |
| Vague specs → vague builds                    | Spec must declare every page (sections, components, modals, interactions, empty/loading/error states), every component (with kind + props), and end-to-end user flows — at least one per feature slice                          |
| "Works in dev"                                | Per-project Docker preview wired into the dashboard; direct-port iframe so Next.js absolute asset URLs resolve                                                                                                                   |
| Opaque cost                                   | Per-request cost tracking, per-provider circuit breaker, configurable monthly budget, cheap-model-by-default where quality allows                                                                                                |

---

## Key features

- **4-stage agent pipeline** (`spec → builder → qa → polish`) executed by a wave-based orchestrator. The QA agent gates the loop: `verdict: 'needs-improvement'` sends BUILDER back with concrete findings, up to `MAX_QA_LOOPS` iterations. Feature-slice mode runs the loop once per slice so complex apps build incrementally.
- **Strict design system** auto-injected into every generated project — `tailwind.config.ts` with `darkMode: 'class'`, `globals.css` with light + dark CSS-variable themes, and 16 ready-to-use primitives at `src/components/ui/` (`Button`, `Input`, `Textarea`, `Select`, `Card`, `Badge`, `Alert`, `Dialog`, `Tabs`, `Separator`, `Avatar`, `Spinner`, `Skeleton`, `EmptyState`, `AppShell`, `PageHeader`, `Toast`). A `DESIGN_SYSTEM.md` is dropped at the project root so the LLM re-anchors on every QA loop.
- **Class-rewriting sanitizer** — invented tokens (`bg-cardBackground`, `text-textPrimary`, `border-borderColor`, …) are deterministically rewritten to canonical semantic equivalents (`bg-card`, `text-foreground`, `border-border`) before assembly.
- **Mechanical QA preflight** — before the QA LLM runs, a static checker scans the file map for unstructured layouts (no sidebar across N pages), broken images (`<img src="/missing.jpg">`), dead buttons (no `onClick` / `submit`), unsubmittable forms (no `onSubmit` / `action`), placeholder content (`lorem ipsum`, "Coming soon"), and runtime risks (`throw new Error('not implemented')`). Findings are surfaced to the LLM as forced criticals; the verdict is auto-downgraded if any remain unpatched.
- **Spec contract** — every `frontendPages[]` entry must declare `sections`, `components`, `modals`, `interactions` (`openModal | call | navigate`), and `empty/loading/error` states. Every project must declare `userFlows[]` with at least one flow per feature slice; flows reference real pages and `apiContracts.id` values, validated cross-step.
- **Multi-provider LLM router** — OpenAI + Anthropic, per-role model selection, exponential-backoff retry with jitter, circuit breaker per provider, automatic fallback, per-request cost tracking, monthly budget guard.
- **Per-project preview container** — Docker image built from the generated source; the dashboard iframe loads directly from the host port so framework-absolute asset URLs (`/_next/static/...`) resolve correctly.
- **Self-healing pipeline** — every step's output is validated post-completion against its declared schema AND cross-step invariants (every `apiContract` implemented, every `frontendPage` rendered, every `userFlow` step references a real page/api). Deterministic programmatic repairs fill missing fields and align upstream/downstream models in-place — no extra LLM call.
- **Trustworthy export** — the export ZIP contains the real generated source plus a real `Dockerfile`, `docker-compose.yml`, `.env.example` extracted from actual `process.env.X` references in code, and a `README.md` synthesised from the detected stack.
- **Iterative refinement** — follow-up prompts run the same 4-stage chain with `seedArtifacts.set('spec', existing.spec)` so the prior specification is preserved.
- **Realtime pipeline UI** — WebSocket events drive a live visualisation of agent progress and QA-loop iterations.

---

## How it works

1. **You submit a prompt** ("Build a marketplace for freelance designers with auth, Stripe, and a dashboard").
2. **Spec agent** expands the prompt into a full product specification — features, tech stack, design system, file tree, `apiContracts`, `frontendPages` (with sections + interactions + modals + states), `components`, `dbSchema`, `envVars`, `featureSlices`, and `userFlows`. Cross-references are validated.
3. **Builder agent** generates the **complete** fullstack codebase — every file in `spec.fileTree`, every route in `spec.apiContracts`, every page with its sections, every modal, every interaction wired to the real API or navigation. No TODOs, no placeholders, no simplified versions. Emits `IMPLEMENTATION_CHECKLIST.md` grouped by Pages / Components / API contracts / User flows / Feature slices.
4. **QA agent** runs after a mechanical preflight (UI structure, assets, functionality, runtime risk). It reviews the codebase against the spec, applies fixes via `patches[]` + `newFiles[]`, and emits `verdict: 'pass' | 'needs-improvement'`. The verdict is auto-downgraded if any critical issue is unpatched.
5. **QA→Builder loop** — `needs-improvement` re-runs BUILDER in feedback mode with the QA findings + previous files. Up to `MAX_QA_LOOPS` iterations.
6. **Polish agent** — additive UI/UX, performance, accessibility, and production-readiness pass.
7. **Project assembler** merges everything in order: `builder.files → qa.newFiles → qa.patches → polish.newFiles → polish.patches → ensureDeploymentReadiness() → injectUIFoundation() → sanitizeUIFoundation() → enforceDesignSystem()`.

While the pipeline runs, you watch every step live. When it completes you can:

- Open the **Docker-backed preview** in the dashboard.
- Browse the generated source tree.
- Submit a **follow-up prompt** to iterate — only affected files are rewritten.
- **Export** the entire project as a ready-to-run ZIP.

---

## Setup

### Prerequisites

- Node.js ≥ 20, npm ≥ 10
- An OpenAI **and/or** Anthropic API key (at least one)
- Docker (for the preview pipeline; required end-to-end)

### Install and run

```bash
git clone <repo-url> dev1
cd dev1
npm install

cp .env.example .env
# Edit .env — set OPENAI_API_KEY and/or ANTHROPIC_API_KEY

npm run dev
```

- Dashboard: `http://localhost:3000`
- Backend API: `http://localhost:3003`
- Health: `http://localhost:3003/health`

### Running a project

1. Open `http://localhost:3000`.
2. Enter a prompt in the prompt panel (e.g. *"A SaaS analytics dashboard. Sidebar with Dashboard/Analytics/Reports/Settings. Top navigation with search and user menu. Main area shows 4 stat cards in a grid, a recent activity table, and a chart placeholder. Dark elegant theme."*).
3. Watch the 4-stage pipeline run live in the agent panel.
4. When the pipeline completes, open **Preview** for a Docker-backed view of the running app.
5. Optionally submit a follow-up prompt to refine ("add dark mode", "switch to shadcn/ui", "use Drizzle instead of Prisma"). Only affected files are rewritten.
6. Click **Export** to download the full ZIP.

### Environment variables

| Variable                     | Required | Default                | Description                                       |
| ---------------------------- | -------- | ---------------------- | ------------------------------------------------- |
| `OPENAI_API_KEY`             | Yes\*    | —                      | OpenAI API key                                    |
| `ANTHROPIC_API_KEY`          | Yes\*    | —                      | Anthropic API key                                 |
| `PORT`                       | No       | `3003`                 | Backend port                                      |
| `STORAGE_PATH`               | No       | `./data`               | Project + memory storage root                     |
| `PROJECTS_DIR`               | No       | `./data/projects`      | Generated project storage                         |
| `MEMORY_DIR`                 | No       | `./data/memory`        | Agent memory storage                              |
| `MAX_CONCURRENT_SESSIONS`    | No       | `5`                    | Pipeline concurrency cap                          |
| `MONTHLY_BUDGET_USD`         | No       | `100`                  | Spend guardrail                                   |
| `ALLOWED_ORIGINS`            | Prod     | —                      | Comma-separated CORS origins                      |
| `NEXT_PUBLIC_API_BASE`       | No       | `http://localhost:3003`| Web → API base URL                                |
| `NEXT_PUBLIC_TELEMETRY_ENABLED` | No    | `0`                    | Enables frontend telemetry sender once backend ingestion exists |
| `MODEL_<ROLE>`               | No       | see ARCHITECTURE.md    | Override model per agent role                     |

\*At least one of OpenAI or Anthropic is required.

---

## Repository layout

```
apps/
  api/         Fastify pipeline server — agents, project store, preview, queues
  web/         Next.js dashboard — pipeline UI, file viewer, preview iframe
core/          Shared logger / config / errors / types
packages/
  agent-core/  Agent framework — base, registry, prompts, orchestrator, validators
infrastructure/
  docker/      Dockerfile.backend, Dockerfile.frontend
  scripts/     deploy.ps1, deploy.sh, backfill helpers
data/
  projects/    Generated project artifacts (per-id directories)
  memory/      Agent memory store
```

Generated projects are written under `data/projects/<id>/` and built by the per-project preview pipeline as standalone Docker images.

---

## Export — what you actually get

Every export ZIP contains:

- **All generated source files** produced by the builder, qa, and polish agents (after the design-system sanitizer pass).
- **`README.md`** generated from the detected stack (Next.js, React, Vue, Svelte, Angular, FastAPI, Flask, Django, NestJS, Fastify, Express, Hono, Prisma, Drizzle, …) with the correct install and dev commands.
- **`.env.example`** extracted from actual `process.env.X` references in the code.
- **`.gitignore`** — language-appropriate.
- **`Dockerfile`**, **`docker-compose.yml`**, optional CI workflow when the polish agent produces them.
- **`DESIGN_SYSTEM.md`** so any future agent or human contributor sees the same design contract the pipeline used.

Path safety (`..`, absolute paths) is enforced both when files are written and again at ZIP time.

---

## Running with Docker

```bash
docker compose up -d                                   # production
docker compose -f docker-compose.dev.yml up            # dev with hot reload
```

---

## API surface

All `/api/*`, `/preview/*`, and `/ws/*` project endpoints require authentication.

- **Production auth**: `Authorization: Bearer <signed-token>` where token payload contains `sub`, `workspaceId`, `role`.
- **Local dev options**:
  - Set `DEV_AUTH_BYPASS=true` to run with a development mock session (`dev-user`, `dev@local.test`, `dev-workspace`, `owner` by default).
  - Customize dev principal with `DEV_USER_ID`, `DEV_USER_EMAIL`, `DEV_WORKSPACE_ID`, and `DEV_USER_ROLE`.
  - Or send `x-devteam-user-id`, `x-devteam-user-email`, `x-devteam-workspace-id`, and `x-devteam-role` headers in development.
- In `NODE_ENV=production`, `DEV_AUTH_BYPASS` is ignored and unauthenticated requests return `401`.

Workspace roles: `owner`, `admin`, `member`, `viewer`.  
`viewer` is read-only and cannot mutate projects, preview runs, or LLM overrides.

### Telemetry status

- Frontend telemetry emitter: `apps/web/src/lib/telemetry/useTrackEvent.ts`.
- Backend telemetry ingestion route `/api/telemetry/events` is currently not implemented.
- Telemetry transport is disabled by default via `NEXT_PUBLIC_TELEMETRY_ENABLED=0`; events are kept in a local in-memory tracker only.

| Method | Path                                               | Purpose                                                      |
| ------ | -------------------------------------------------- | ------------------------------------------------------------ |
| `GET`  | `/health`                                          | Liveness probe                                               |
| `POST` | `/api/projects`                                    | Create project + start pipeline (202, async)                |
| `POST` | `/api/projects/generate`                           | Alias for create project                                     |
| `GET`  | `/api/projects`                                    | List projects                                                |
| `GET`  | `/api/projects/:id`                                | Read full project record                                     |
| `DELETE` | `/api/projects/:id`                              | Delete project                                               |
| `GET`  | `/api/projects/:id/files`                          | File tree                                                    |
| `GET`  | `/api/projects/:id/files/*`                        | Single file contents                                         |
| `POST` | `/api/projects/:id/prompts`                        | Submit follow-up prompt                                      |
| `POST` | `/api/projects/:id/update`                         | Alias for project update                                     |
| `GET`  | `/api/projects/:id/prompts`                        | Prompt history                                               |
| `GET`  | `/api/projects/:id/versions`                       | Version metadata history                                     |
| `GET`  | `/api/projects/:id/versions/:version`              | Version snapshot                                             |
| `GET`  | `/api/projects/:id/export`                         | Export ZIP                                                   |
| `GET`  | `/api/projects/:id/diagnostics`                    | Full diagnostics block                                       |
| `GET`  | `/api/projects/:id/diagnostics/pipeline-ledger`    | Per-step pipeline run ledger                                |
| `GET`  | `/api/projects/:id/diagnostics/preview-validation-artifacts` | Preview validation artifacts                     |
| `POST` | `/api/projects/:id/preview/start`                  | Start preview runtime                                        |
| `POST` | `/api/projects/:id/preview/stop`                   | Stop preview runtime                                         |
| `GET`  | `/api/projects/:id/preview/status`                 | Preview runtime status                                       |
| `POST` | `/api/projects/:id/preview/validate`               | Preview validate + optional auto-fix                         |
| `GET`  | `/api/preview/health`                              | Preview backend availability                                 |
| `GET`  | `/api/sessions/:id/progress`                       | Poll session progress                                        |
| `GET`  | `/api/sessions/active`                             | List active sessions                                         |
| `GET`  | `/api/llm/costs`                                   | LLM cost summary                                             |
| `GET`  | `/api/llm/costs/records`                           | Raw LLM cost records                                         |
| `GET`  | `/api/llm/circuit-breaker`                         | Circuit-breaker states                                       |
| `GET`  | `/api/llm/providers`                               | Registered providers                                         |
| `GET`  | `/api/llm/providers/health`                        | Provider health checks                                       |
| `GET`/`POST`/`DELETE` | `/api/llm/overrides` / `/api/llm/overrides/:target` | Model override management                     |
| `WS`   | `/ws/sessions/:id/progress`                        | Realtime pipeline events                                     |

```bash
curl -X POST http://localhost:3003/api/projects \
  -H "Content-Type: application/json" \
  -d '{"prompts":["Build a Next.js + Postgres job board with auth"]}'
```

---

## Extending the system

The canonical agent framework lives in [packages/agent-core](packages/agent-core/). To add or change an agent:

1. Update the `AgentRole` union in [packages/agent-core/src/types.ts](packages/agent-core/src/types.ts).
2. Register the agent in [packages/agent-core/src/agent-registry.ts](packages/agent-core/src/agent-registry.ts) (model, I/O schema, memory config, retry policy, dependencies, system prompt).
3. Implement the agent class under [apps/api/src/agents/](apps/api/src/agents/) extending `BaseAgent`; wire it into [apps/api/src/agents/factory.ts](apps/api/src/agents/factory.ts).
4. Add a step entry in `PIPELINE_STEPS` in [packages/agent-core/src/pipeline-types.ts](packages/agent-core/src/pipeline-types.ts).
5. Add an input-builder branch in [packages/agent-core/src/agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts) so the agent receives only the artifacts it depends on.
6. Add per-role semantic validation in [packages/agent-core/src/step-validator.ts](packages/agent-core/src/step-validator.ts).
7. If the agent produces files, extend the merge order in [apps/api/src/pipeline/project-assembler.ts](apps/api/src/pipeline/project-assembler.ts).
8. Run `npx tsc -p apps/api --noEmit` and `npx tsc -p packages/agent-core --noEmit`.

For deep technical detail — agent contracts, validator rules, design-system enforcement, QA static checks, preview pipeline — see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## License

Proprietary. All rights reserved.
