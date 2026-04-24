# DEVteam

**A multi-agent AI platform that turns a one-line prompt into a runnable fullstack application — with a live in-browser preview and a production-ready export.**

DEVteam is not a codegen wrapper around a single model. It is an orchestrated team of 10 specialised agents (intent expander, planner, architect, developer, reviewer, tester, debugger, quality enforcer, optimizer, devops) that collaborate through a typed pipeline-state object, with per-role model selection, wave-based parallel execution, retry + circuit-breaker routing across OpenAI and Anthropic, a two-layer self-heal + QA gate, and a deterministic preview + export pipeline.

> One prompt in. A reviewed, tested, containerised, downloadable repository out.

---

## Why DEVteam is different

| Most AI code tools | DEVteam |
|---|---|
| Single model, one shot | 10 specialised agents, each with its own role, model, memory, and validation contract |
| "Looks right" output | Every agent returns strict JSON, validated against a declared schema AND cross-step invariants before entering state; deterministic auto-repair fills gaps in-place |
| No safety net | Two-layer defence: the step-validator blocks bad agent output during execution; a final QA gate (UI, layout, e2e, preview, placeholders) blocks low-quality projects from ever being marked `completed` |
| Preview is a screenshot | Live in-browser React preview with framework stubs (Next.js, Redux, routing) and mocked backend — deterministic, no backend required |
| README is copy-pasted | README, `.env.example`, `.gitignore`, Dockerfile generated from the actual code — not the planner's claims |
| Opaque cost | Per-request cost tracking, per-provider circuit breaker, configurable monthly budget, cheap-model-by-default where quality allows |
| Rebuilds from scratch on every prompt | Follow-up prompts run a 3-stage update pipeline (planner → coder → reviewer) and preserve untouched files |

---

## Key features

- **10-stage agent pipeline** (`intent_expander → planner → architect → developer → reviewer → tester → debugger → quality_enforcer → optimizer → devops`) executed by a wave-based orchestrator that runs independent agents in parallel and skips steps whose preconditions are unmet. Every skip is recorded and streamed.
- **Multi-provider LLM router** — OpenAI + Anthropic (+ Google/Gemini), per-role model selection, exponential-backoff retry with jitter, circuit breaker per provider, automatic fallback, per-request cost tracking, monthly budget guard.
- **Intent expansion up-front** — the first agent rewrites a vague prompt into a detailed product specification (features, UI expectations, quality standards, constraints, non-goals). Every downstream agent consumes the expanded prompt; the original prompt is used only as a fallback. The routing contract is enforced in [agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts).
- **Live in-browser preview** — React/Next.js projects render instantly via Babel-standalone with stubs for `next/link`, `next/router`, `next/navigation`, `next/image`, `react-redux`, `@reduxjs/toolkit`, `redux`. Fully sandboxed (`sandbox="allow-scripts allow-forms allow-modals allow-popups"`, no `allow-same-origin`) so the preview cannot reach the host app, cookies, or any backend. Multi-CDN fallback chain (unpkg → jsdelivr → cdnjs) for React/ReactDOM/Babel/Tailwind, a 4-second watchdog that replaces a blank `#root` with a synthesized placeholder, path-aware mock data (products/orders/users/messages/…), pre-seeded auth session so apps render their authenticated UI on first paint, and a **universal component-stub injector** that auto-declares any undeclared capital-letter identifier used in JSX — so imports from unstubbed libraries never blank the screen. No backend required at runtime.
- **Production-grade dashboard** — the DEVteam control surface ships as a real SaaS: branded indigo→violet gradient wordmark, full 5-level elevation system, multi-stop shadows, gradient primary buttons with brand glow, polished empty states, ambient grid + radial background, refined typography (Inter OpenType features, tight tracking), 8 px styled scrollbars, global `:focus-visible` indigo rings, and reusable component primitives (`.btn`, `.card`, `.card-elevated`, `.avatar`, `.kbd`, `.eyebrow`, `.empty-state`).
- **Crash-proof integration layer** — every API call goes through a branded `ApiError` wrapper with hard timeout, content-type-aware parsing, and per-endpoint normalizers that guarantee no undefined field reaches the UI. Unreachable-backend detection (network / timeout) falls back to safe empty data for list/file endpoints so the dashboard renders even when the API is offline; real 4xx/5xx errors still bubble to toasts.
- **Self-healing pipeline** — every step's output is validated after completion against its declared schema AND cross-step invariants (e.g. developer files vs. architect tree; reviewer issues forwarded to debugger; UI scores vs. quality bar). Deterministic programmatic repairs fill missing fields, coerce shapes, and align upstream/downstream data models in-place — no extra LLM call. Unrepairable errors hard-stop the pipeline (`step:blocked` → `pipeline:failed`) so broken generations never reach the user.
- **Final QA gate** — after every project is assembled, a full-codebase QA pass scores it against five bars (UI modernness, layout structure, end-to-end wiring, preview renderability, zero placeholders). Deterministic auto-fixes are applied (strip `TODO: implement me`, patch missing Next `app/layout.tsx` or Vite entry, remove `throw new Error('Not implemented')`). Any remaining blockers force the project to `failed` status with a persisted `qaAssurance` report — low-quality outputs are never marked `completed`.
- **Trustworthy export** — the export ZIP contains the real source plus a README generated by inspecting the code (detecting Next/FastAPI/Django/Prisma/Drizzle/etc.) and an `.env.example` extracted from real `process.env.X` references. Path traversal is blocked at both codegen and zip time.
- **Iterative refinement** — follow-up prompts on an existing project run a shortened planner → coder → reviewer loop and only rewrite files that changed.
- **Realtime pipeline UI** — WebSocket events (`session.started`, `step.started`, `step.completed`, `step.skipped`, `progress`, `session.completed`, `session.failed`) drive a live visualisation of agent progress.
- **Concurrency-safe** — a second prompt against a running project returns 409 with the in-flight session id.
- **Cost-aware by default** — Claude Opus is reserved for architect, reviewer, and quality_enforcer; Claude Sonnet drives intent expansion, planning, development, testing, debugging, and optimisation; GPT-4o-mini handles devops. Roughly 60% cheaper than a uniform Opus pipeline, with automatic fallback across providers on failure.

---

## How it works

1. **You submit a prompt** ("Build a marketplace for freelance designers with auth, Stripe, and a dashboard").
2. **Intent Expander** rewrites the vague prompt into a detailed product specification — features (core/standard/stretch), UI expectations (pages, components, empty/loading/error states, a11y, design language), quality standards, constraints, non-goals, assumptions. The expanded prompt is what every downstream agent sees; the original is used only as a fallback.
3. **Planner** decomposes the spec into a structured task list with priorities, dependencies, and stack hints.
4. **Architect** produces the file tree, tech stack, DB schema, API contracts, component list, and environment variables.
5. **Developer** writes every source file (runs with parallelism across file sets).
6. **Reviewer** scores the codebase 0–100 and flags bugs, security issues, performance concerns, and contract violations.
7. **Tester** generates unit/integration/e2e test files and coverage expectations.
8. **Debugger** applies targeted patches for reviewer- and tester-surfaced issues; anything it cannot fix is forwarded as `unresolved`.
9. **Quality Enforcer** scores UI / functional / code / consistency quality on a 0–100 rubric. On any dimension below 80 it emits concrete patches and newFiles (e.g. missing empty states).
10. **Optimizer** applies performance, bundle, query, caching, and accessibility improvements.
11. **DevOps** produces the Dockerfile, docker-compose, CI workflow, and `.env.example`.

After every step the **self-heal validator** checks the output against its declared schema + cross-step invariants and auto-repairs programmatically. Unrepairable errors hard-stop the pipeline. After assembly, the **final QA gate** scores the merged project against five bars (UI modernness, layout, e2e wiring, preview renderability, no placeholders), applies deterministic fixes, and refuses to mark any failing project `completed`.

While the pipeline runs, you watch every step live. When it completes you can:

- Open the **live preview** in the browser.
- Browse the generated source tree.
- Submit a **follow-up prompt** to iterate — only affected files are rewritten.
- **Export** the entire project as a ready-to-run ZIP.

---

## Example use cases

- **SaaS MVPs** — auth + dashboard + billing + CRUD in one pass.
- **Internal tools** — admin panels, review queues, moderation consoles against an existing API.
- **Marketplaces** — listings, search, messaging, payments.
- **Landing + dashboard combos** — public site plus authenticated app.
- **API backends** — typed REST services with Prisma/Drizzle/SQLAlchemy and Dockerfile.
- **Prototype-to-production handoff** — generate, preview, iterate, export, hand to engineering.

Not a fit for: novice "learn to code" use cases, pixel-perfect clones of existing products, or teams that need white-glove manual architecture (DEVteam picks the stack unless you override it).

---

## Who it's for

- **Indie founders** shipping MVPs in hours instead of weeks.
- **Agencies** spinning up client prototypes and internal tools at scale.
- **Product teams** accelerating the 0→1 phase with a reviewable, exportable starting point.
- **Engineers** who want a real code artifact — not a chat transcript — to iterate on.

DEVteam is positioned as a **premium tool**. The output is meant to be handed to engineers, not treated as disposable.

---

## Setup

### Prerequisites

- Node.js ≥ 20, npm ≥ 10
- An OpenAI **and/or** Anthropic API key (at least one)
- Docker (optional, for containerised deployment)

### Install and run

```bash
git clone <repo-url> devteam
cd devteam
npm install

cp .env.example .env
# Edit .env — set OPENAI_API_KEY and/or ANTHROPIC_API_KEY

npm run build
npm run dev
```

- Dashboard: http://localhost:3000
- Backend API: http://localhost:3001
- Health: http://localhost:3001/health

### Running a project

1. Open http://localhost:3000.
2. Enter a prompt in the prompt panel (e.g. *"Build a Next.js + Postgres job board with auth"*).
3. Watch the 10-stage pipeline run live in the agent panel.
4. When the pipeline completes, open **Preview** for a rendered view, or **Files** to read source.
5. Optionally submit a follow-up prompt to refine ("add dark mode", "switch to shadcn/ui", "use Drizzle instead of Prisma"). Only affected files are rewritten.
6. Click **Export** to download the full ZIP.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes* | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | Yes* | — | Anthropic API key |
| `PORT` | No | `3001` | Backend port |
| `STORAGE_PATH` | No | `./data` | Project + memory storage |
| `JWT_SECRET` | Prod | dev default | Signing secret |
| `MAX_CONCURRENT_SESSIONS` | No | `5` | Pipeline concurrency cap |
| `MONTHLY_BUDGET_USD` | No | `100` | Spend guardrail |
| `ALLOWED_ORIGINS` | Prod | — | Comma-separated CORS origins |
| `NEXT_PUBLIC_API_BASE` | No | `http://localhost:3001` | Web → API base URL |
| `MODEL_<ROLE>` | No | see architecture | Override model per agent role |

*At least one of OpenAI or Anthropic is required.

---

## Export — what you actually get

Every export ZIP contains:

- **All source files** produced by the coder, integration, debugger, tester, optimizer, and devops agents.
- **`README.md`** generated by inspecting the code (detects Next.js, React, Vue, Svelte, Angular; FastAPI, Flask, Django, NestJS, Fastify, Express, Koa, Hono, Go, Rust; Prisma, Drizzle, Sequelize, TypeORM, Mongoose, SQLAlchemy) — with the correct install and dev commands for that stack.
- **`.env.example`** extracted from actual `process.env.X` references in the code, not from the planner's claims.
- **`.gitignore`** — language-appropriate.
- **`Dockerfile`, `docker-compose.yml`, CI workflow** when the DevOps agent produces them.

Preview-only files (`/preview-only/`, mocks, in-browser stubs) are stripped from the export. Path safety (`..`, absolute paths) is enforced both when the coder writes a file and again at ZIP time.

---

## Running with Docker

```bash
docker compose up -d                                   # production
docker compose -f docker-compose.dev.yml up            # dev with hot reload
```

---

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness probe |
| `POST` | `/api/projects` | Create project + start the 10-stage pipeline (202, runs async) |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/:id` | Read project (status, files, expandedSpec, qaAssurance, tasks…) |
| `GET` | `/api/projects/:id/files` | File tree |
| `GET` | `/api/projects/:id/file?path=` | Single file contents |
| `POST` | `/api/projects/:id/prompts` | Submit follow-up prompt (returns 409 if running) |
| `GET` | `/api/projects/:id/prompts` | Prompt history |
| `GET` | `/api/projects/:id/versions` | Version snapshots |
| `POST` | `/api/projects/:id/versions/:v/restore` | Restore a version |
| `GET` | `/api/projects/:id/preview` | Live in-browser preview HTML |
| `GET` | `/api/projects/:id/export` | Export ZIP |
| `GET` | `/api/projects/:id/container` | Container / runtime info |
| `GET` | `/api/sessions/:id/progress` | Poll session progress |
| `GET` | `/api/agents/models` | List available LLM models |
| `POST` | `/api/agents/models/:role` | Override model for an agent role |
| `GET` | `/api/agents/cost` | Per-provider cost summary |
| `GET` | `/api/agents/circuit` | Circuit-breaker status |
| `WS`  | `/ws/session/:sessionId` | Realtime pipeline events (see below) |

**WebSocket events** (emitted by [packages/agent-core/src/pipeline-types.ts](packages/agent-core/src/pipeline-types.ts)): `pipeline:started`, `wave:started`, `step:started`, `step:retrying`, `step:completed`, `step:validated`, `step:repaired`, `step:blocked`, `step:failed`, `step:skipped`, `pipeline:completed`, `pipeline:failed`.

```bash
curl -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -d '{"prompts":["Build a Next.js + Postgres job board with auth"]}'
```

---

## Positioning

DEVteam is aimed at teams that ship. Output is code, not a demo. Follow-up prompts iterate cheaply. Models, costs, and circuit state are visible. Preview is deterministic. Export is trustworthy. That is the product.

For deep technical detail — agent contracts, orchestration internals, preview rendering, cost routing, error handling, known gaps, and improvement roadmap — see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Extending the system

The canonical agent framework lives in [packages/agent-core](packages/agent-core/). To add a new agent:

1. Add the role to `AgentRole` in [packages/agent-core/src/types.ts](packages/agent-core/src/types.ts).
2. Register the agent definition (model, I/O schema, memory config, retry policy, dependencies, system prompt) in [packages/agent-core/src/agent-registry.ts](packages/agent-core/src/agent-registry.ts) under `AGENT_DEFINITIONS`.
3. Implement the agent class under [apps/api/src/agents/](apps/api/src/agents/) extending `BaseAgent`; wire it into [apps/api/src/agents/factory.ts](apps/api/src/agents/factory.ts) `createAllAgents()`.
4. Add a pipeline step (id, name, description, critical flag) in `PIPELINE_STEPS` in [packages/agent-core/src/pipeline-types.ts](packages/agent-core/src/pipeline-types.ts).
5. Add an input-builder branch in [packages/agent-core/src/agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts) so the agent receives only the artifacts it declares as dependencies.
6. Add per-role semantic validation (optional) in [packages/agent-core/src/step-validator.ts](packages/agent-core/src/step-validator.ts).
7. If the agent produces files, extend the merge order in [apps/api/src/pipeline/project-assembler.ts](apps/api/src/pipeline/project-assembler.ts).
8. Run `npm run type-check` and `npm run test` from the repo root.

See [ARCHITECTURE.md](ARCHITECTURE.md) §2 –10-stage agent pipeline” and §14 “Extending the system” for a worked example.

Testing CodeRabbit
---

## License

Proprietary. All rights reserved.
