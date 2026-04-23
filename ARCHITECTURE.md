# DEVteam — Platform Architecture

> Accurate as of the intent-expansion + quality-enforcement update (April 2026). This document describes the system **as actually implemented**, not as originally envisioned. See README.md for setup.

---

## 0. Recent changes — Intent expansion & quality enforcement

Two agents were added to bookend the pipeline in `packages/agent-core` / `apps/api/src/agents/`:

### `intent_expander` (new first stage)

Runs **before** `planner`. Takes the raw user prompts (which may be vague) and produces a detailed product specification:

- `productName`, `productCategory`, `oneLiner`, `targetUsers[]`
- `expandedPrompts[]` — ≥400-word elaborated prompt; `expandedPrompts[0]` is the single source of truth every downstream agent consumes.
- `features` (`core` / `standard` / `stretch`), `uiExpectations` (pages, components, nav, empty/loading/error states, responsive, a11y, design language), `qualityStandards` (performance, security, codeQuality, testing, errorHandling, uxPolish)
- `constraints`, `nonGoals`, `assumptions`

Routing guarantee — implemented in [agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts): **`intent_expander` is the only agent that sees `session.prompts`.** Every other agent receives the expanded prompts plus `expandedSpec` in its input; this is the enforced contract for "downstream agents use the expanded prompt, not the original".

### `quality_enforcer` (new stage after `debugger`)

Scores the post-debugger codebase across four dimensions (0–100, pass ≥ 80):

- `uiQuality` · `functionalQuality` · `codeQuality` · `consistency`

Outputs `verdict` (`pass` | `needs-improvement`), `findings[]`, `patches[]` (edits to existing files), `newFiles[]` (missing components such as empty states), and a `summary`. Contract: if any per-dimension score < 80 the verdict **must** be `needs-improvement` and the agent must emit at least one patch or newFile per failing dimension (validated in [quality-enforcer-agent.ts](apps/api/src/agents/quality-enforcer-agent.ts)).

### File-merge order

[project-assembler.ts](apps/api/src/pipeline/project-assembler.ts) now merges in this order:

```
developer.files → devops.files → tester.testFiles →
debugger.patches → reviewer.patches →
quality_enforcer.newFiles → quality_enforcer.patches →
optimizer.patches
```

### Persisted artifacts

`ProjectRecord` (in [project-store.ts](apps/api/src/storage/project-store.ts)) gains `expandedSpec?` and `qualityReport?`. Both generator and updater populate them ([project-generator.ts](apps/api/src/pipeline/project-generator.ts), [project-updater.ts](apps/api/src/pipeline/project-updater.ts)).

### Skip rules

`quality_enforcer` skips when no developer files exist (same rule as `optimizer`).

---

## 1. System overview

DEVteam is a **multi-agent AI platform** that turns a natural-language prompt into a runnable fullstack application. It is a Turborepo monorepo of TypeScript/Node.js packages. A single Fastify backend drives an 11-stage agent pipeline; a Next.js frontend renders real-time progress, an in-browser preview, and export.

```
┌──────────────────────────────────────────────────────────────────┐
│                    apps/web  (Next.js 15, :3000)                 │
│  ProjectList · PromptPanel · AgentPipeline · FileViewer ·        │
│  LivePreview · LogsPanel · ToastStack                            │
└────────────────────────────┬─────────────────────────────────────┘
                             │  REST  +  WebSocket
┌────────────────────────────▼─────────────────────────────────────┐
│                  apps/backend  (Fastify, :3001)                  │
│  routes/  projects · prompts · preview · export · ws · agents    │
│  storage/ ProjectStore (JSON on disk)                            │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│             services/orchestration  (pipeline driver)            │
│  Orchestrator · SessionManager · step executor · retry logic     │
└─┬──────────────────────────┬────────────────────────┬────────────┘
  │                          │                        │
  ▼                          ▼                        ▼
services/agents         services/memory         services/api-routing
11 BaseAgent subclasses   File-based store        LLM router + retry +
                                                  circuit breaker + costs
                                                           │
                                               ┌───────────┴────────────┐
                                               ▼                        ▼
                                          OpenAI                   Anthropic
```

### Layer responsibilities

| Layer | Path | Responsibility |
|---|---|---|
| Frontend | `apps/web` | Prompt UI, project list, pipeline visualisation, preview, export download |
| Backend | `apps/backend` | REST + WebSocket server, project persistence, preview renderer, export builder |
| Orchestration | `services/orchestration` | Drives the 11-stage pipeline, merges artifacts, emits events |
| Agents | `services/agents` | 11 `BaseAgent` subclasses, one per pipeline stage |
| Memory | `services/memory` | Agent-scoped memory store (current: file-based) |
| LLM routing | `services/api-routing` | Multi-provider router with retry, circuit breaker, cost tracking |
| Core | `core` | Shared types, config, logger, error classes, id/time helpers |

---

## 2. The 11-stage agent pipeline

```
prompt
   │
   ▼
┌────────────────────┐
│ 1. intent_analyzer │  Extracts projectType, complexity, features,
└────────┬───────────┘  capabilities, brandVibe, stackHints.
         │              Produces a refined prompt.
         ▼
┌────────────────────┐
│ 2. planner         │  Chooses techStack, writes goals, milestones,
└────────┬───────────┘  risks. First point where language/framework
         │              is finalised.
         ▼
┌────────────────────┐
│ 3. architect       │  Designs folderStructure, components, API
└────────┬───────────┘  endpoints, data models, styling approach.
         │
         ▼
┌────────────────────┐
│ 4. ui_ux           │  Emits concrete designSystem (palette, type,
└────────┬───────────┘  radii, motion) + tailwind.config + globals.css.
         │              [skipped when !hasFrontend]
         ▼
┌────────────────────┐
│ 5. coder           │  Writes every source file, consuming plan +
└────────┬───────────┘  architecture + designSystem.
         │
         ▼
┌────────────────────┐
│ 6. integration     │  Wires frontend ↔ backend: fetch calls, api
└────────┬───────────┘  clients, CORS, env vars, shared types.
         │              [skipped when !hasFrontend || !hasBackend]
         ▼
┌────────────────────┐
│ 7. reviewer        │  Static review — bugs, security, performance,
└────────┬───────────┘  quality score.
         │
         ▼
┌────────────────────┐
│ 8. debugger        │  Applies fixes for critical/major reviewer
└────────┬───────────┘  issues. [skipped when no major issues]
         │
         ▼
┌────────────────────┐
│ 9. tester          │  Generates unit/integration test files.
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ 10. optimizer      │  Perf/readability/a11y/SEO passes on source
└────────┬───────────┘  files. [skipped when complexity=simple]
         │
         ▼
┌────────────────────┐
│ 11. devops         │  Dockerfile, compose, CI, deploy scripts,
└────────┬───────────┘  .env.example baseline.
         │
         ▼
  Project (artifacts.files[], status=completed)
```

### Intelligent routing (conditional skip)

Every step receives a `canSkip` predicate that inspects upstream outputs. Current skip rules:

| Step | Skip condition |
|---|---|
| `ui_ux` | `intent.capabilities.hasFrontend === false` |
| `integration` | `!hasFrontend \|\| !hasBackend` |
| `debugger` | No critical/major issues AND no security concerns |
| `tester` | No source files (only test files) exist |
| `optimizer` | `intent.complexity === 'simple'` OR no performance concerns |

Each skip emits `step.skipped` over the WebSocket with a reason and contributes to `pipeline.optimization.skippedSteps`.

### Standardised agent contract

Every agent extends [`BaseAgent<TInput, TOutput>`](services/agents/src/base-agent.ts) and implements:

```ts
abstract class BaseAgent<TInput, TOutput> {
  readonly role: AgentRole;
  protected readonly maxOutputTokens: number = 8192;

  async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>>;

  protected abstract buildPrompt(input: TInput, memories: MemoryEntry[]): string;
  protected abstract parseOutput(raw: string): TOutput;
}

interface AgentResult<T> {
  output: T;
  reasoning?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  memoryIds: string[];
}

interface AgentContext {
  sessionId: string;
  projectId: string;
  memory: AgentMemoryAdapter;
  llm: AgentLLMAdapter;
}
```

Each `BaseAgent.run()` call:
1. Loads relevant memories (`ctx.memory.retrieve`)
2. Builds an LLM prompt via `buildPrompt()`
3. Invokes the LLM router (`ctx.llm.complete`)
4. Parses + validates the JSON output via `parseOutput()`
5. Stores learnings to memory (`ctx.memory.store`)
6. Returns a structured `AgentResult` to the orchestrator

The orchestrator wraps every call in `runStep()` which:
- Checks `canSkip()` predicates
- Records step status (`running → completed | failed | skipped`)
- Adds attempt count (retries are per-agent, hard-capped)
- Accumulates tokens + cost onto the pipeline totals

---

## 3. Agent roster — inputs and outputs

| # | Agent | File | Input | Output |
|---|---|---|---|---|
| 1 | `IntentAnalyzerAgent` | [intent-analyzer-agent.ts](services/agents/src/agents/intent-analyzer-agent.ts) | `{ prompt, preferences? }` | `{ refinedPrompt, projectType, complexity, features[], capabilities{}, brandVibe, targetAudience, stackHints, clarifyingQuestions[], summary }` |
| 2 | `PlannerAgent` | [planner-agent.ts](services/agents/src/agents/planner-agent.ts) | `{ prompt, preferences?, memoryHints? }` | `{ projectName, summary, goals[], techStack{}, architecture, milestones[], risks[] }` |
| 3 | `ArchitectAgent` | [architect-agent.ts](services/agents/src/agents/architect-agent.ts) | `{ plan }` | `{ overview, folderStructure[], components[], apiEndpoints[], dataModels[], stateManagement, stylingApproach, keyDecisions[] }` |
| 4 | `UIUXAgent` | [ui-ux-agent.ts](services/agents/src/agents/ui-ux-agent.ts) | `{ plan, intent }` | `{ designSystem{ palette, typography, radii, spacing, motion, componentLibrary, density, darkMode }, layoutPatterns[], componentsNeeded[], pages[], styleFiles[], summary }` |
| 5 | `CoderAgent` | [coder-agent.ts](services/agents/src/agents/coder-agent.ts) | `{ plan, architecture?, designSystem?, layoutPatterns?, componentsNeeded?, existingStyleFiles? }` | `{ files[], summary, dependencies{} }` |
| 6 | `IntegrationAgent` | [integration-agent.ts](services/agents/src/agents/integration-agent.ts) | `{ files, apiEndpoints, architecture, intent }` | `{ files[] (changed only), wirings[], issues[], summary }` |
| 7 | `ReviewerAgent` | [reviewer-agent.ts](services/agents/src/agents/reviewer-agent.ts) | `{ files, plan }` | `{ approved, summary, issues[], securityConcerns[], performanceConcerns[], score }` |
| 8 | `DebuggerAgent` | [debugger-agent.ts](services/agents/src/agents/debugger-agent.ts) | `{ files, reviewIssues, securityConcerns }` | `{ files[] (fixed only), fixesApplied[], remainingIssues[], summary }` |
| 9 | `TesterAgent` | [tester-agent.ts](services/agents/src/agents/tester-agent.ts) | `{ files, plan }` | `{ testFiles[], coverage[], missingCoverage[], summary }` |
| 10 | `OptimizerAgent` | [optimizer-agent.ts](services/agents/src/agents/optimizer-agent.ts) | `{ files, performanceConcerns }` | `{ files[] (optimized), changes[], summary }` |
| 11 | `DevOpsAgent` | [devops-agent.ts](services/agents/src/agents/devops-agent.ts) | `{ files, projectName, preferences? }` | `{ deploymentFiles[], summary, deployInstructions[] }` |

### Shared state

There is **one** mutable shared object per pipeline run: the `Project.artifacts` record. Each agent's output is either:

1. **Merged into `artifacts.files[]`** (ui_ux styleFiles, coder files, integration fixes, debugger fixes, tester testFiles, optimizer rewrites, devops deployment files) — merge is path-Set based with deterministic precedence rules; or
2. **Written to a typed artifact field** (`artifacts.plan`, `artifacts.reviewNotes`, `artifacts.testSuite`, `artifacts.deploymentConfig`)

No agent sees the `artifacts` object directly. The orchestrator extracts the specific subset each agent needs into its typed input.

---

## 4. Orchestration flow

### Entry points

| HTTP | Path | Flow |
|---|---|---|
| `POST` | `/api/projects` | Create project + start pipeline (202 Accepted, runs async) |
| `POST` | `/api/projects/:id/prompts` | Queue a follow-up prompt (returns 409 if project is already running) |
| `GET` | `/api/projects/:id` | Poll project state |
| `GET` | `/api/projects/:id/preview` | Render live in-browser preview |
| `GET` | `/api/projects/:id/export` | Stream ZIP with README, .env.example, .gitignore |
| `WS` | `/ws/session/:id` | Realtime `session.started` / `step.started` / `step.completed` / `step.skipped` / `progress` / `session.completed` / `session.failed` |

### Orchestrator class

[`services/orchestration/src/orchestrator.ts`](services/orchestration/src/orchestrator.ts) — the `Orchestrator` owns one instance of each agent, a memory adapter, and an LLM adapter. Public surface:

```ts
class Orchestrator {
  constructor(deps: { memory, llm, onEvent?, onProjectSave? });

  // New project — fire-and-forget; returns ids immediately
  startAsync(request: CreateProjectRequest): { projectId, sessionId, project };

  // Update existing project — runs planner → coder → reviewer only
  startUpdateAsync(existingProject: Project, newPrompt: string): { sessionId };

  // Synchronous run (used by tests)
  run(request, projectId?, sessionId?, existingProject?): Promise<{ project, pipeline }>;
}
```

### Update pipeline (shortened)

[`orchestrator-update.ts`](services/orchestration/src/orchestrator-update.ts) runs a **3-stage** pipeline on follow-up prompts: planner → coder → reviewer. This is an intentional cost tradeoff. New files from the coder replace old files with the same path; untouched old files are preserved. `project.promptHistory[].changedFiles` tracks the diff.

### Concurrency safety

`POST /:id/prompts` checks `existingProject.status === 'running'` and returns **409 Conflict** with the in-flight `currentSessionId` when a pipeline is already active for the same project. This prevents two pipelines from racing on the same artifact set.

---

## 4a. Project state structure

The single source of truth for any run is the `Project` object (see [core/src/types.ts](core/src/types.ts)). It is persisted as JSON to `apps/backend/data/projects/<id>.json` by `ProjectStore` and mutated in place by the orchestrator.

```ts
interface Project {
  id: string;
  name: string;
  prompt: string;                         // most recent prompt
  prompts?: PromptHistoryEntry[];         // full history (text, createdAt, sessionId, changedFiles)
  versions?: ProjectVersion[];            // snapshots for rollback
  preferences?: ProjectPreferences;       // language, framework, testFramework, cloud target
  artifacts: ProjectArtifacts;            // ← shared mutable state
  status: PipelineStatus;                 // pending | running | completed | failed | cancelled
  sessionId?: string;                     // in-flight session id when running
  createdAt: string;
  updatedAt: string;
  costUsd?: number;                       // accumulated cost
  tokensUsed?: number;                    // accumulated tokens
  error?: string;                         // on failure
}

interface ProjectArtifacts {
  files: ProjectFile[];                   // all source files (merged, path-deduped)
  plan?: string;                          // planner JSON (stringified)
  architecture?: string;                  // architect JSON
  testSuite?: string;                     // tester JSON
  reviewNotes?: string;                   // reviewer JSON
  deploymentConfig?: string;              // devops JSON
}

interface PipelineState {
  sessionId: string;
  projectId: string;
  status: PipelineStatus;
  steps: PipelineStep[];                  // per-role status, tokens, cost, skippedReason
  totalDurationMs?: number;
  totalCostUsd?: number;
  totalTokens?: number;
  optimization: OptimizationMetrics;      // cacheHits/Misses, skippedSteps, executedSteps
}
```

### How state evolves

1. `POST /api/projects` creates the `Project` with `status='pending'`, empty `artifacts.files`, and a fresh `PipelineState`.
2. Each agent runs through `runStep()`, which updates the matching `PipelineStep` (`running → completed|failed|skipped`), accumulates `totalTokens` / `totalCostUsd`, and merges its output into `artifacts`:
   - `planner` → `artifacts.plan`
   - `architect` → `artifacts.architecture`
   - `ui_ux` → `artifacts.files += styleFiles[]` (`globals.css`, `tailwind.config.*`)
   - `coder` → `artifacts.files += files[]` (all sources)
   - `integration` → `artifacts.files` updated in place for changed paths
   - `reviewer` → `artifacts.reviewNotes`
   - `debugger` → `artifacts.files` updated in place for fixed paths
   - `tester` → `artifacts.files += testFiles[]`, `artifacts.testSuite`
   - `optimizer` → `artifacts.files` updated in place for optimized paths (never touches test files)
   - `devops` → `artifacts.files += deploymentFiles[]`, `artifacts.deploymentConfig`
3. File merging is path-keyed (`Map<path, ProjectFile>`) with deterministic precedence: later stages override earlier ones for the same path, except the optimizer which is gated by a "only rewrites source files it actually changed" rule.
4. At the end, `project.status = 'completed'`, `project.costUsd` and `project.tokensUsed` are copied from the pipeline totals, and the project is persisted.
5. For **follow-up prompts** (`POST /:id/prompts`), the update orchestrator runs planner → coder → reviewer, new files replace same-path entries, and `promptHistory[n].changedFiles` records the diff. Untouched files are preserved verbatim.

Agents never see the full `Project`. The orchestrator extracts a typed slice into each agent's input, keeping the agent contract narrow and the state surface auditable.

---

## 5. LLM routing (`services/api-routing`)

### Router responsibilities

[`router.ts`](services/api-routing/src/router.ts) is the single entry point agents use. For each request it:

1. **Selects a model** based on `agentRole` from `config.llm.modelsByRole`
2. **Executes with retry** (`executeWithRetry`, up to 3 attempts) — exponential backoff with jitter (250ms × 2^attempt + random jitter, capped at 8s)
3. **Classifies retriable errors** (`isRetriable`): retries on 429, 5xx, network, timeout, "overloaded"; skips retry on 401/403/4xx
4. **Records circuit breaker outcome** per provider — opens after consecutive failures
5. **Tracks cost** via `CostTracker` per request (input + output tokens × provider rate)
6. **Falls back** to secondary provider on irrecoverable failure

### Model routing table (defaults)

Configured in [`core/src/config.ts`](core/src/config.ts), overridable by env var `MODEL_<ROLE>`:

| Role | Default model | Rationale |
|---|---|---|
| `intent_analyzer` | gpt-4o-mini | Short analytic task, cheap model sufficient |
| `planner` | gpt-4o | Broad reasoning, stack selection |
| `architect` | gpt-4o | Structured spec generation |
| `ui_ux` | gpt-4o | Design quality matters, worth the tokens |
| `coder` | gpt-4o | Large output, strongest codegen |
| `integration` | gpt-4o-mini | Localised wiring fixes, cheap model OK |
| `reviewer` | claude-3-5-sonnet | Claude is strong at code critique |
| `tester` | gpt-4o-mini | Templated output |
| `debugger` | gpt-4o-mini | Targeted patches |
| `optimizer` | gpt-4o-mini | Pattern-replace style work |
| `devops` | gpt-4o-mini | Boilerplate-heavy |

---

## 6. Memory system (`services/memory`)

Current implementation is **file-based** (JSON per `agentRole`). The `MemoryStore` interface has a planned Postgres+pgvector implementation but is not yet wired.

```ts
interface MemoryStore {
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
  retrieve(query: MemoryQuery): Promise<MemoryEntry[]>;
}

interface MemoryEntry {
  id: string;
  agentRole: AgentRole | 'global';
  sessionId?: string;
  content: string;
  type: 'context' | 'pattern' | 'decision' | 'error_fix';
  relevanceScore: number;
  createdAt: Date;
}
```

Query is bag-of-words scoring (O(n), acceptable at current scale). Memories are injected into `buildPrompt()` by each agent's `recallMemories()` hook.

---

## 7. Preview system

Goal: run the **frontend** of any generated project in the user's browser, without executing the backend.

[`apps/backend/src/routes/preview-renderer.ts`](apps/backend/src/routes/preview-renderer.ts) produces a standalone HTML document containing:

1. React 18 + ReactDOM from CDN
2. Tailwind CDN (so designSystem tokens render)
3. `@babel/standalone` for in-browser TSX transpilation
4. A script block that concatenates all project TSX/JSX files
5. Framework stubs ([`preview-stubs.ts`](apps/backend/src/routes/preview-stubs.ts)) — browser-safe shims for `next/link`, `next/router`, `next/navigation`, `next/image`, `react-redux`, `@reduxjs/toolkit`, `redux`
6. `preprocessDefaultExports()` — rewrites each file's default export to a synthetic `__d_<path>` id, then rewrites relative default imports to those ids (solves "X is not defined" on cross-file defaults)
7. A smart root detection: `App.tsx` → `pages/_app + pages/index` → `pages/index` → first `^[A-Z]` default export
8. Mocks for all backend calls — `fetch` is routed to a stub that returns placeholder data

Excluded from preview: `tests/`, `cypress/`, `e2e/`, `playwright/`, `*.config.*`, `*.test.*`, `*.spec.*`, `*.cy.*`, anything resembling a Prisma schema or raw SQL.

The whole preview is served from a single HTTP endpoint with no iframe messaging, no WebSocket, no runtime state — you can reload and get the same deterministic output.

---

## 8. Export system

[`apps/backend/src/routes/export-builder.ts`](apps/backend/src/routes/export-builder.ts) produces a ZIP with:

- All real source files (no mocks, no preview stubs)
- `README.md` — generated via `detectTechStack()` which inspects file contents (not planner claims) to identify frontend (Next/React/Vue/Angular/Svelte), backend (FastAPI/Flask/Django/NestJS/Fastify/Express/Koa/Hono/Go/Rust), database (Prisma/Sequelize/TypeORM/Drizzle/pg/Mongoose/SQLAlchemy), and test framework. Install + dev-server steps are switched per-stack (`npm install`/`pip install -r requirements.txt`, `npm run dev`/`uvicorn`)
- `.env.example` — extracted from actual `process.env.X` usage in the code
- `.gitignore` — language-appropriate
- Any Dockerfile / compose / CI files produced by the DevOps agent

Path safety: every entry is validated to reject `..` traversal and absolute paths (enforced at `CoderAgent.parseOutput` and again at zip time).

---

## 9. Error handling and self-healing

| Failure mode | Where handled | Behaviour |
|---|---|---|
| LLM 429 / 5xx / network | `router.executeWithRetry` | Exponential backoff + jitter, up to 3 attempts |
| LLM auth error | `router.executeWithRetry` | Fail fast, no retry |
| Provider sustained failure | `CircuitBreaker` | Opens breaker, routes to fallback provider |
| Invalid agent JSON | `BaseAgent.extractJson` + `parseOutput` | Throws `ValidationError`; agent-level retry inside pipeline (up to step-configured `maxAttempts`) |
| Missing path / path traversal in coder output | `CoderAgent.parseOutput` | Silently drops bad entries; fails if zero valid files remain |
| Concurrent prompt on running project | `POST /:id/prompts` | Returns 409 with in-flight `currentSessionId` |
| Reviewer flags critical/major issues | `DebuggerAgent` step | Automatically fixes or flags as `remainingIssues` |
| Optimizer makes things worse | Orchestrator merge logic | Test files are never touched; unchanged-by-optimizer source files are preserved |
| Pipeline crashes mid-run | Orchestrator try/catch | `status=failed`, saves partial artifacts, emits `session.failed`, surfaces `error` on project |

There is no periodic sweeper for stuck sessions — a crashed process leaves `status=running` projects that the user must manually retry. This is a known limitation.

---

## 10. Observability

- Every agent logs to `Logger('agent:<role>')` with sessionId, durationMs, tokens, costUsd
- Every pipeline run emits `session.*` and `step.*` events over WebSocket (consumed by `apps/web/components/AgentPipeline.tsx`)
- Cost + tokens accumulate on `PipelineState.totalCostUsd` / `totalTokens` and are copied to `project.costUsd` / `project.tokensUsed`
- `GET /api/agents/cost` returns per-provider totals
- `GET /api/agents/circuit` returns circuit-breaker state per provider

---

## 11. Key design principles (what we actually do)

1. **One pipeline, one state object.** `project.artifacts` is the single source of truth. Agents get typed views, not the whole state.
2. **JSON-only agent outputs.** Every agent returns strict JSON, validated in `parseOutput()`. Malformed or path-unsafe output is rejected before it enters state.
3. **Skip by default when upstream says so.** No step runs "just in case". Every skip is recorded.
4. **Retry at the right layer.** Transient LLM failures retry in the router. Business-logic validation failures fail the step.
5. **Preview is deterministic.** No backend execution, no user-state. Same files → same HTML.
6. **Export is trustworthy.** README is based on what the code actually is, not what the planner claimed. `.env.example` comes from real `process.env` references.
7. **Designer before coder.** UI quality is driven by the UIUXAgent producing a real design system that the CoderAgent is prompted to follow.
8. **Cheap models where quality allows.** `gpt-4o` only for planner / architect / ui_ux / coder. Everything else uses `gpt-4o-mini` or Sonnet. ~60% cost reduction vs uniform `gpt-4o`.

---

## 12. Directory reference

```
dev1/
├── core/                          # Shared types (AgentRole, Project, PipelineState), config, logger
│   └── src/
│       ├── types.ts               # AgentRole = 11 literals
│       ├── config.ts              # modelsByRole, LLM keys, auth
│       ├── logger.ts
│       └── errors.ts              # ValidationError, etc.
├── services/
│   ├── agents/src/
│   │   ├── base-agent.ts
│   │   └── agents/
│   │       ├── intent-analyzer-agent.ts
│   │       ├── planner-agent.ts
│   │       ├── architect-agent.ts
│   │       ├── ui-ux-agent.ts
│   │       ├── coder-agent.ts
│   │       ├── integration-agent.ts
│   │       ├── reviewer-agent.ts
│   │       ├── debugger-agent.ts
│   │       ├── tester-agent.ts
│   │       ├── optimizer-agent.ts
│   │       └── devops-agent.ts
│   ├── orchestration/src/
│   │   ├── orchestrator.ts        # 11-stage runner
│   │   ├── orchestrator-update.ts # 3-stage update runner
│   │   ├── orchestrator-events.ts # WS event emission
│   │   ├── pipeline.ts            # PipelineState builders
│   │   └── session-manager.ts
│   ├── memory/src/                # MemoryStore, FileMemoryStore
│   └── api-routing/src/
│       ├── router.ts              # Retry, fallback, CostTracker, CircuitBreaker
│       ├── openai-client.ts
│       └── anthropic-client.ts
├── apps/
│   ├── backend/src/               # Fastify :3001
│   │   ├── app.ts / server.ts
│   │   ├── websocket.ts
│   │   └── routes/
│   │       ├── projects.ts        # POST/GET/DELETE + POST /:id/prompts
│   │       ├── preview.ts / preview-renderer.ts / preview-stubs.ts
│   │       ├── export.ts / export-builder.ts
│   │       └── agents.ts / health.ts
│   └── web/                       # Next.js 15 :3000
│       ├── app/
│       └── components/
│           ├── PromptPanel.tsx · ProjectList.tsx · Sidebar.tsx
│           ├── AgentPipeline.tsx · AgentActivityPanel.tsx
│           ├── FileExplorer.tsx · FileViewer.tsx
│           ├── LivePreview.tsx · LogsView.tsx · LogsPanel.tsx
│           └── RightPanel.tsx · AppHeader.tsx · ChatInput.tsx · ToastStack.tsx
├── packages/
│   └── agent-core/                # Legacy pre-services layout; AGENT_DEFINITIONS registry
├── infrastructure/
│   ├── docker/ Dockerfile.backend, Dockerfile.frontend
│   ├── ci/ deploy.yml
│   └── scripts/ deploy.ps1, deploy.sh, backfill-generated.ps1
├── tests/unit/                    # Jest unit tests (orphaned workspace; see Known gaps)
├── apps/backend/test-system.cjs   # Live 26-check end-to-end smoke test
├── docker-compose.yml / docker-compose.dev.yml
├── turbo.json
├── package.json
└── ARCHITECTURE.md (this file) / README.md
```

---

## 13. Known gaps (intentional, documented)

1. **Update pipeline is shortened** (planner → coder → reviewer). Follow-up prompts do not re-run debugger/tester/optimizer/devops. This is a cost-vs-quality tradeoff. Full regeneration requires creating a new project.
2. **`tests/` workspace is orphaned** — not included in root `workspaces`, Jest not installed. The authoritative regression harness is `apps/backend/test-system.cjs` (26 checks, runs against live backend).
3. **Reviewer does not loop back after Debugger** — debugger fixes are not re-reviewed. Coder output validator (`parseOutput`) catches the high-impact failure modes upstream.
4. **Memory retrieval is O(n)** — fine at <1K entries per role. Swap to pgvector when measurable.
5. **No auth** — backend accepts any origin. Add a Fastify `preHandler` with JWT verification before public deployment.
6. **Preview only supports React-family frontends** — Python/Go/Rust backends export and run fine locally but do not render in the browser preview.
7. **Stuck-session sweeper** — a crashed process leaves `status=running` records; no background reconciler exists.
8. **Docker sandbox preview** — planned but not implemented; current preview is direct in-browser Babel, not isolated containerised execution.

---

## 14. Extending the system

To add a new agent (e.g. a **Research** agent as a 12th stage):

1. Add the role literal to `AgentRole` in [core/src/types.ts](core/src/types.ts)
2. Add a model mapping in [core/src/config.ts](core/src/config.ts) `modelsByRole`
3. Create `services/agents/src/agents/research-agent.ts` extending `BaseAgent<ResearchInput, ResearchOutput>` — implement `buildPrompt()` and `parseOutput()`
4. Export it from [services/agents/src/index.ts](services/agents/src/index.ts)
5. Instantiate + wire it into [orchestrator.ts](services/orchestration/src/orchestrator.ts) — add to the `buildInitialPipelineState(...)` role list, call `runStep({ role: 'research', ... })` at the desired position, and merge its output into `project.artifacts`
6. Rebuild: `npm run build --workspace=@devteam/core && npm run build --workspace=@devteam/agents && npm run build --workspace=@devteam/orchestration`
7. Re-run `node apps/backend/test-system.cjs` to confirm no regression

The pipeline is explicitly designed so that adding a stage is a localised change — no event-bus plumbing, no registry registration required in the happy path.

---

## 15. Scalability considerations

### Cost control (today)

- Per-request cost tracked by `CostTracker` and surfaced via `GET /api/agents/cost`.
- Cheap models (`gpt-4o-mini`, Sonnet) for 7 of 11 agents.
- Conditional skip reduces ~30% of steps on simple or backend-only projects.
- Update pipeline (3 stages) is ~70% cheaper than full regeneration for iteration.
- `MONTHLY_BUDGET_USD` env guardrail exists but is **not currently enforced** in the router — it is read but not checked (see improvements below).

### Performance (today)

- Fastify backend with request logging, rate limit (120 req/min), Helmet.
- In-memory step + request cache (`Map`) — process-local.
- WebSocket events push progress to the UI instead of polling.
- `ProjectStore` reads/writes a single JSON file per project from disk.

### Known scaling bottlenecks

| Area | Current | Limit | Mitigation |
|---|---|---|---|
| Storage | JSON file per project | Single-node, no concurrent writers | Swap `ProjectStore` → Postgres |
| Memory search | Bag-of-words, O(n) | ~1K entries/role | Swap `FileMemoryStore` → pgvector |
| Step cache | In-process `Map` | Lost on restart, not shared | Redis |
| Pipeline concurrency | Single process | `MAX_CONCURRENT_SESSIONS` cap | BullMQ + workers |
| Auth | None | Public deployment unsafe | Fastify `preHandler` + JWT |
| Preview | Browser Babel | React-family only | Optional containerised sandbox |
| Budget enforcement | Env var only | Nothing stops overspend | Pre-request check in router |

---

## 16. Weaknesses and prioritised improvements

The following list is the result of an honest audit against the implementation. Items are grouped by priority and impact.

### P0 — Security / correctness blockers

1. **No authentication on the backend.** Any caller can create, read, delete, or export any project. Add a Fastify `preHandler` that verifies a JWT (config stub already exists in `core/src/config.ts`). Gate every `/api/*` route; leave `/health` open.
2. **Budget enforcement is cosmetic.** `MONTHLY_BUDGET_USD` is loaded but never checked. Add a pre-request guard in `services/api-routing/router.ts` that rejects (or downgrades to a cheaper model) when cumulative monthly cost exceeds the budget.
3. **Stuck-session recovery is manual.** A process crash leaves `status=running` projects forever. Add a startup reconciler that marks any `status=running` session older than N minutes as `failed` with `error='session_abandoned'`.
4. **Tests workspace is orphaned.** `tests/unit/` is not in `package.json` workspaces and Jest is not installed. Either wire it up (`"tests"` in `workspaces`, add Jest, run in CI) or delete it. The current ambiguity is worse than either choice.

### P1 — Output quality

5. **Reviewer does not re-review debugger fixes.** After the debugger rewrites files, there is no verification that the fixes are correct. Add a lightweight `reviewer_verify` pass (cheap model) that only re-runs if the debugger applied fixes.
6. **No syntax / typecheck gate on coder output.** `CoderAgent.parseOutput` checks path safety but not that files parse. Wire `@babel/parser` (already indirectly available via preview) or `typescript` as a compile-check; reject files that don't parse and retry the coder step.
7. **Integration agent runs after coder but before reviewer.** Wiring errors it introduces aren't caught until the reviewer runs and usually aren't flagged because the reviewer gets the changed file set without the integration context. Reorder: reviewer should see `integration.wirings` as an explicit input.
8. **Design system is not enforced by the coder.** The UI/UX agent emits tokens, but the coder prompt is advisory — it can still produce stock Tailwind. Feed the design system as a strict constraint list (allowed colours, font families) and validate generated Tailwind classes against it.

### P2 — Scalability

9. **File-based `ProjectStore` does not support concurrent writes.** Two requests against the same project can clobber each other's JSON. Swap to Postgres (or at minimum a write-lock file) before any multi-tenant deployment.
10. **In-process step + request cache.** Replace with Redis for any deployment that runs more than one backend instance.
11. **Pipeline runs in the request process.** Offload to BullMQ workers — the API already returns 202, so the UX change is zero; the scaling change is large.
12. **Memory store is bag-of-words.** The interface is vector-ready; plug in `pgvector` with OpenAI/Cohere embeddings. Expected to materially improve repeated-prompt quality.

### P3 — Preview and export

13. **Preview only supports React-family frontends.** Python/Go/Rust backends export fine but have no visual preview. Add a containerised sandbox mode (Dockerfile-based) for non-React stacks; gate behind an env flag.
14. **Preview does not surface runtime errors well.** Babel errors bubble to the console. Add an error overlay that catches `window.onerror` / `unhandledrejection` and displays them in the preview panel.
15. **Export README is code-inspected but not run-tested.** The generated install/dev commands are correct per stack but never executed. Add an optional `--verify` mode that runs `npm install && npm run build` in a temp dir.

### P4 — Developer experience

16. **`packages/agent-core` is legacy.** It predates `services/agents/` and is not used by the live pipeline. Either delete it or document that it exists only for historical agent metadata.
17. **No CI runs the 26-check smoke test.** `infrastructure/ci/deploy.yml` builds and deploys but does not run `apps/backend/test-system.cjs`. Add it as a required check.
18. **Prompt templates are inline in each agent file.** Extract to `services/agents/src/prompts/<role>.md` for easier iteration and A/B experimentation.
19. **Logger is process-local console output.** Add structured JSON logging with a request id correlation field (already generated in `app.ts` via `genReqId`) and ship to a central sink in production.

### P5 — Product

20. **No versioning UI.** `ProjectVersion[]` exists in the type but the web app does not expose snapshot / rollback. Surface it.
21. **No "explain this project" view.** The architect and planner outputs are stored but not rendered. A dedicated "Spec" tab in the web app would dramatically increase perceived value.
22. **No shareable preview URLs.** Previews are local-only. An optional read-only share token on the preview route would unlock demo / review use cases.
23. **No model-cost estimate before running.** The prompt panel should surface an estimated cost range based on intent.complexity before the user hits Run.

### Summary — top 5 to do next

1. Add JWT auth + enforce monthly budget in the router. **(P0)**
2. Add a startup reconciler for abandoned `status=running` projects. **(P0)**
3. Add a typecheck/parse gate on coder output and a reviewer re-verify pass after the debugger. **(P1)**
4. Swap `ProjectStore` and step cache to Postgres + Redis before multi-tenant. **(P2)**
5. Surface architect/planner spec and version history in the web UI. **(P5 — highest commercial upside)**

