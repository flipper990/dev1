# DEVteam — Architecture

> Authoritative reference for the **4-agent pipeline** (`spec → builder → qa → polish`). Last updated April 2026.

---

## 1. System overview

DEVteam takes a user prompt and produces a runnable, polished, fullstack codebase. The pipeline is:

```
spec  →  builder  →  qa  ⇄  builder    →  polish  →  assemble
                     │
                     └── verdict 'needs-improvement' loops up to MAX_QA_LOOPS
```

Every agent returns strict JSON validated against a declared schema and cross-step invariants. Deterministic auto-repair fills gaps. The assembler merges agent outputs in a fixed order and runs three sanitizer passes (deployment readiness, design-system injection, class-token enforcement) before emitting the final file set.

The runtime is a Turborepo monorepo:

```
apps/api/         Fastify pipeline server, agents, project store, preview, queues
apps/web/         Next.js dashboard
core/             Shared config / logger / errors / types
packages/
  agent-core/     Agent framework — base, registry, prompts, orchestrator, validator
infrastructure/   Dockerfiles, deploy scripts
data/
  projects/       Generated project artifacts
  memory/         Agent memory store
```

---

## 2. The 4 agents

The role union is fixed at four members in [base-types.ts](packages/agent-core/src/base-types.ts). Concrete classes live under [apps/api/src/agents/](apps/api/src/agents/):

| # | Role      | Model (primary / fallback)    | File                                                            | Responsibility |
|---|-----------|-------------------------------|-----------------------------------------------------------------|----------------|
| 1 | `spec`    | claude-opus-4 / gpt-4o        | [spec-agent.ts](apps/api/src/agents/spec-agent.ts)              | Expand the prompt into a full product specification — features, tech stack, design system, file tree, `apiContracts`, `frontendPages` (with sections + interactions + modals + states), `components`, `userFlows`, `dbSchema`, `envVars`, `featureSlices`. Single source of truth for every later agent. |
| 2 | `builder` | claude-sonnet-4 / gpt-4o      | [builder-agent.ts](apps/api/src/agents/builder-agent.ts)        | Generate the **complete** fullstack codebase — every file in `spec.fileTree`, every route in `spec.apiContracts`, every page with its sections, every modal, every interaction wired to the real API. No TODOs, no placeholders, no simplified versions. Emits `IMPLEMENTATION_CHECKLIST.md`. |
| 3 | `qa`      | claude-opus-4 / gpt-4o        | [qa-agent.ts](apps/api/src/agents/qa-agent.ts)                  | Run the static-check preflight, review the codebase, apply fixes via `patches[]` + `newFiles[]`, emit `verdict: 'pass' \| 'needs-improvement'`. The verdict is auto-downgraded post-LLM if any critical is unaddressed. |
| 4 | `polish`  | claude-sonnet-4 / gpt-4o-mini | [polish-agent.ts](apps/api/src/agents/polish-agent.ts)          | Modern SaaS-grade UI/UX, performance, accessibility, production readiness (`Dockerfile`, `README.md`, scripts, `.env.example`). Additive-only. |

Defined declaratively in [agent-registry.ts](packages/agent-core/src/agent-registry.ts) with input/output schemas. Pipeline order in [pipeline-types.ts](packages/agent-core/src/pipeline-types.ts):

```ts
export const PIPELINE_STEPS: PipelineStep[] = [
  { id: 'spec',   agent: 'spec',    critical: true  },
  { id: 'build',  agent: 'builder', critical: true  },
  { id: 'qa',     agent: 'qa',      critical: true  },
  { id: 'polish', agent: 'polish',  critical: false },
];
```

Wave-scheduled by [orchestrator.ts](packages/agent-core/src/orchestrator.ts) using the `dependencies` declared in `AGENT_DEFINITIONS` (`spec=[]`, `builder=['spec']`, `qa=['builder']`, `polish=['qa']`) — strictly serial.

---

## 3. Spec contract

The spec is the single source of truth. Its prompt and schema (in [prompts/spec.ts](packages/agent-core/src/prompts/spec.ts) and [agent-registry.ts](packages/agent-core/src/agent-registry.ts)) require:

- **`expandedPrompt`** — ≥400-word elaborated brief; PM-style.
- **`features`** — `core`, `standard`, `stretch`.
- **`featureSlices[]`** — ordered foundation→leaves (auth → users → core content → interactions → notifications → search → settings → domain extras). Each slice is independently shippable; the pipeline iterates over them so complex apps build incrementally.
- **`techStack`** — defaults to Next.js 15 + Fastify + PostgreSQL + Prisma unless the product is genuinely frontend-only.
- **`designSystem`** — concrete hex values, typography, spacing, radii, shadows, primitives.
- **`fileTree[]`** — every file to generate, with purpose.
- **`apiContracts[]`** — exact method + path, request/response schemas, error envelope, auth flag.
- **`frontendPages[]`** — for each page: `path`, `name`, `file`, `auth`, `purpose`, `sections[]` (id + components), flat `components[]` (union), `modals[]` (component names of overlays), `interactions[]` (`{trigger, action: openModal | call | navigate, target, thenRefresh}`), `dataDeps[]` (apiId + trigger + mocked flag), and `emptyState` / `loadingState` / `errorState`.
- **`components[]`** — `name`, `path`, `kind` (`page-section | modal | primitive | layout`), typed `props[]`, `usesPrimitives[]`.
- **`userFlows[]`** — at least one flow per `featureSlice`. Each flow has ordered `steps[{ page, action, apiId, expect }]` with `successCriteria[]`. Flows are how QA validates feature completeness end-to-end.
- **`dbSchema`** / **`envVars`** / **`uiExpectations`** / **`qualityStandards`** / **`constraints`** / **`nonGoals`** / **`assumptions`**.

Cross-references are validated in [step-validator.ts](packages/agent-core/src/step-validator.ts) `semanticSpec`:

- Every `frontendPages[].file` must exist in `fileTree`.
- Every component referenced on a page must exist in `components[]`.
- Every modal listed on a page must exist in `components[]`.
- Every `dataDeps[].apiId` must exist in `apiContracts[]` (or be flagged `mocked: true`).
- Every `userFlows[].steps[].page` must match a `frontendPages[].path`.
- Every `userFlows[].steps[].apiId` (when present) must exist in `apiContracts[]`.
- `userFlows.length ≥ featureSlices.length` (at least one flow per slice).

Runtime spec validation is duplicated in [spec-agent.ts](apps/api/src/agents/spec-agent.ts) `validateOutput` so malformed specs fail fast before reaching BUILDER.

---

## 4. Builder contract

[prompts/builder.ts](packages/agent-core/src/prompts/builder.ts) is the system prompt. Key contract points:

- **Coverage** — generate every file in `fileTree`, every route in `apiContracts`, every page (with sections rendered in DOM order), every component at its declared path, every modal as a portal-based overlay, every interaction wired to the real apiId / navigation / modal trigger, every `userFlow` working end-to-end.
- **Fullstack layout** when `techStack.backend !== 'none'`:
  ```
  apps/web/                   Next.js app, lib/api-client.ts as the SOLE network layer
  apps/web/Dockerfile         multi-stage, exposes 3000
  apps/api/                   Fastify (server.ts + plugins/ + routes/<slice>.ts + lib/db.ts)
  apps/api/Dockerfile         multi-stage, exposes 4000, runs `prisma migrate deploy` on start
  apps/api/prisma/schema.prisma   one model per spec.dbSchema.tables[]
  apps/api/prisma/seed.ts          realistic demo data
  docker-compose.yml          web ↔ api ↔ postgres on a shared network
  .env.example                every var from spec.envVars
  ```
- **No simplified builds** — if the spec lists 6 feature slices, the build must contain all 6, not a 3-slice MVP.
- **Design system** — primitives are imported from `@/components/ui` (never redefined); class names come exclusively from the [design-system contract](#7-design-system-enforcement).
- **Output checklist** — `IMPLEMENTATION_CHECKLIST.md` is the last file, grouped by `## Pages`, `## Components`, `## API contracts`, `## User flows`, `## Feature slices`. Any unchecked box invalidates the output.
- **Feedback mode** — when `qaFeedback` is in the input, address every issue listed and emit incremental files; preserve every other file in `existingFiles` byte-for-byte.
- **Slice mode** — when `currentSlice` is in the input, implement only that slice this pass; preserve earlier slices; do not stub out future slices.

Builder cross-step validation in [step-validator.ts](packages/agent-core/src/step-validator.ts) `semanticBuilder`:

- Every `apiContracts[].path` must appear somewhere in the generated source (`builder.missing-api-contracts`).
- Every `frontendPages[].file` must exist in the file map (`builder.missing-pages`).
- Every `components[].path` must exist in the file map (`builder.missing-components`).
- `IMPLEMENTATION_CHECKLIST.md` must exist (`builder.missing-checklist`).
- Every `userFlows[].steps[].page` must appear in the source (`builder.broken-user-flows`).
- The checklist must list every `userFlows[].id` (`builder.checklist-missing-flows`).

---

## 5. QA agent — strict gating

QA is the gate. It refuses to ship low-quality output. Three layers, in order:

### 5a. Static-check preflight ([qa-static-checks.ts](apps/api/src/agents/qa-static-checks.ts))

Deterministic mechanical scan of the assembled file map BEFORE the LLM runs. Each finding has a stable id, severity, and concrete `suggestedFix`:

- **`ui-structure`** — multi-page repo without `<AppShell>` / `<aside>+<main>` / `<nav>+<main>` (critical). App-router project missing `src/app/layout.tsx` (critical).
- **`broken-asset`** — `<img>` / `<Image>` with no src; src pointing at a path that doesn't resolve in `files[]`; src on a fictional domain (`example.com`, `your-cdn`). Allowed: known placeholder hosts (`picsum.photos`, `placehold.co`, `images.unsplash.com`, `ui-avatars.com`, `api.dicebear.com`, `avatars.githubusercontent.com`), real local files in `public/`, or dynamic prop-driven srcs. Suggested fix is always a concrete `https://picsum.photos/seed/<slug>/<w>/<h>` URL.
- **`unwired-interaction`** — `<button>` without `onClick` / `type="submit"` / `form` / `disabled` (high).
- **`unsubmittable-form`** — `<form>` without `onSubmit` or `action` (critical).
- **`placeholder-content`** — lorem ipsum, "Coming soon", "TODO", "Implement me", "Placeholder text" in JSX (high).
- **`runtime-risk`** — `throw new Error('not implemented' | 'unimplemented' | 'todo')` on a render path (critical).

### 5b. LLM review ([prompts/qa.ts](packages/agent-core/src/prompts/qa.ts))

The static findings are surfaced at the top of the QA prompt as forced criticals. The LLM then performs deeper semantic review (cross-references spec ↔ code, checks security, traces async error handling, validates `runtimeFeedback` from the live preview) and produces patches + newFiles. It also enforces:

- Every `frontendPages[].sections[]` is rendered in DOM order on its page.
- Every `interactions[]` is wired (openModal opens the named modal, call hits the named apiId, navigate routes correctly).
- Every `userFlows[].steps` sequence works end-to-end.
- "Simplified builds" (3 of 6 slices = critical fail) and stub pages (page exists but renders TODO/Coming Soon) are rejected.

### 5c. Verdict override gate ([qa-agent.ts](apps/api/src/agents/qa-agent.ts) `validateOutput`)

Post-LLM, if `verdict === 'pass'` but:

1. any static-check critical/high was not acknowledged by id and not addressed by a patch/newFile to its file, OR
2. any LLM-self-reported critical issue is unpatched,

the verdict is **forcibly downgraded** to `needs-improvement`, synthetic issues are appended for every ignored static finding, and the summary is prefixed with `[Verdict downgraded by QA gate: ...]`. This makes it impossible for the LLM to rubber-stamp a broken build.

### 5d. QA → Builder loop

Implemented in [project-generator.ts](apps/api/src/pipeline/project-generator.ts) (`MAX_QA_LOOPS = 2`, so up to 3 builder runs total):

```
build → qa → (verdict?)
              ├── 'pass'              → polish → assemble → done
              └── 'needs-improvement' → spawn next session
                                        ├── seed: { spec: original_spec }   // skip spec
                                        ├── artifact: qaFeedback            // findings
                                        ├── artifact: previousFiles         // last build
                                        ├── artifact: builderIteration      // counter
                                        └── execute(nextSession, seedMap)   // builder feedback mode
                                            └── loop again (up to MAX_QA_LOOPS)
```

The builder prompt's QA-FEEDBACK MODE addresses every finding and may emit incremental diffs. Final iteration count is persisted on `project.optimization.qaIterations`. The orchestrator emits a `qa:loop` event for each iteration so the UI can show progress.

---

## 6. Project assembler

[project-assembler.ts](apps/api/src/pipeline/project-assembler.ts) merges artifacts in a fixed order:

```
1. builder.files                       starting point
2. qa.newFiles                         additions QA spotted as missing (path-normalised)
3. qa.patches                          QA's auto-fixes (oldContent: '' = whole-file replace)
4. polish.newFiles                     Dockerfile, README.md, .env.example, deploy scripts
5. polish.patches                      final UI/perf polish
6. ensureRunnableScaffold()            bare scaffold guarantees (package.json, entry)
7. ensureDeploymentReadiness()         Dockerfile + .env.example baseline
8. injectUIFoundation()                primitives + tailwind config + globals.css + DESIGN_SYSTEM.md
9. sanitizeUIFoundation()              repair broken globals.css / tailwind config / layout.tsx
10. enforceDesignSystem()              rewrite invented className tokens
```

Steps 8–10 are detailed in §7.

---

## 7. Design system enforcement

The pipeline injects a complete UI foundation into every project so generated UI looks consistent. Implemented in [ui-foundation.ts](apps/api/src/pipeline/ui-foundation.ts).

### 7a. Injected primitives — `injectUIFoundation()`

Each is emitted only when not already present:

- `src/lib/cn.ts` — class merge helper.
- `tailwind.config.ts` — `darkMode: 'class'`, semantic colour tokens via `hsl(var(--*))`, plugin `tailwindcss-animate`, content globs covering `src/app/**`, `src/components/**`, `src/pages/**`.
- `src/app/globals.css` — `@tailwind base/components/utilities`, `:root` light theme + `.dark, [data-theme="dark"]` dark theme with 21 CSS variables (background, foreground, card×2, popover×2, primary×2, secondary×2, muted×2, accent×2, destructive×2, border, input, ring, radius), and `body { bg-background; color: foreground; }`.
- `src/components/ui/` — 16 primitives:
  `Button`, `Input`, `Textarea`, `Select`, `Card` (with `CardHeader/Title/Description/Content/Footer`), `Badge`, `Alert` (with `AlertTitle/AlertDescription`), `Dialog` (with `DialogTrigger/Content/Header/Title/Description/Footer`), `Tabs` (with `TabsList/Trigger/Content`), `Separator`, `Avatar` (with `AvatarImage/Fallback`), `Spinner`, `Skeleton`, `EmptyState`, `AppShell` (collapsing sidebar + sticky topbar + content area), `PageHeader`, `Toast` (provider + `useToast` hook).
- `src/components/ui/index.ts` — barrel.
- `DESIGN_SYSTEM.md` at the project root — human-readable contract that gets re-fed to the builder as `existingFiles` on every QA-loop iteration.

### 7b. Sanitizer — `sanitizeUIFoundation()`

Repairs broken EXISTING files emitted by the LLM (gap-fill won't help when the LLM ships a broken globals.css):

1. Replaces `tailwind.config.ts` when missing `content:[]` or referencing an empty `design-tokens` module.
2. Replaces `globals.css` when missing `@tailwind` directives OR core `--background` / `--foreground` vars.
3. Fills empty `designTokens = {}` stubs with a valid-but-empty shape.
4. For `layout.tsx` files, injects `className="dark"` on `<html>` and `className="bg-background text-foreground antialiased"` on `<body>` when missing.

### 7c. Class-rewriting — `enforceDesignSystem()`

Deterministic regex pass over every `.tsx/.jsx/.ts/.js` file. Rewrites known invented tokens to canonical semantic equivalents:

```
bg-cardBackground       → bg-card
text-cardForeground     → text-card-foreground
border-cardBorder       → border-border
bg-mainBg / mainBackground → bg-background
text-mainText / textPrimary → text-foreground
text-textSecondary / Muted → text-muted-foreground
text-headingColor       → text-foreground
bg-primaryColor         → bg-primary
text-primaryColor       → text-primary
… (20+ rewrites)
```

The rewriter logs `enforceDesignSystem: rewrote N invented className tokens across M file(s)` whenever it fires.

### 7d. Design-system contract in prompts

[prompts/shared.ts](packages/agent-core/src/prompts/shared.ts) exports `DESIGN_SYSTEM_CONTRACT` which is appended to `SHARED_PREAMBLE` and therefore visible to every agent. It enumerates:

- Allowed colour classes (the 21 semantic tokens with `/10 /20 /50 /80 /90` opacity).
- Allowed radius / spacing scale.
- Allowed primitives with exact `@/components/ui/*` import paths.
- Layout template (AppShell + PageHeader + Card grids; `max-w-screen-2xl mx-auto`; spacing `4/6/8`).
- Banned patterns — invented camelCase tokens, raw hex / rgb in className, primitive re-implementation, bare `<div>` page chrome, hardcoded image paths to non-existent assets, inline `style={{...}}` for color/spacing.

The builder prompt explicitly names the invented tokens (`bg-cardBackground`, `text-textPrimary`, …) as banned.

---

## 8. Persisted artifacts

[project-store.ts](apps/api/src/storage/project-store.ts) writes per-slice JSON under `data/projects/<id>/`:

- `spec` — output of the SPEC agent (full product specification).
- `qaReport` — output of the QA agent (verdict, scores, issues, patches, newFiles, summary).
- `qualityReport` — output of the POLISH agent.
- `qaAssurance` — output of the deterministic post-assembly QA gate (when present).
- `optimization.qaIterations` — number of builder runs (1 = no loop, max 3).
- `tasks` — per-step summaries for the UI.
- `previewState` — Docker preview status (image id, host port, container state).

Storage is rooted at the **repo root** (`data/projects` and `data/memory`) — outside the api `src/` tree so `tsx watch` does not reload the server when artifacts are written. Path resolution lives in [config.ts](apps/api/src/config.ts):

```ts
projectsDir: resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/projects')
```

---

## 9. Update flow

For an existing project, [project-updater.ts](apps/api/src/pipeline/project-updater.ts) runs the same `builder → qa → polish` chain with `seedArtifacts.set('spec', existing.spec)` so the prior specification is preserved. `scope: 'code' | 'design' | 'full'` is a hint — `'full'` re-runs spec from scratch; `'code'` and `'design'` reuse the seeded spec.

---

## 10. LLM routing — `apps/api/src/llm`

- Per-role model selection from `MODELS` in [agent-registry.ts](packages/agent-core/src/agent-registry.ts).
- Multi-provider router with circuit breaker per provider, exponential-backoff retry with jitter, and automatic fallback on provider failure.
- Per-request cost tracking; monthly budget guardrail (`MONTHLY_BUDGET_USD`).
- Cost-aware defaults — Opus is reserved for `spec` and `qa`; Sonnet drives `builder` and `polish`; GPT-4o handles fallbacks.

---

## 11. Preview pipeline

The Docker-backed preview is decoupled from the agent pipeline:

- [docker-preview.ts](apps/api/src/preview/docker-preview.ts) builds a per-project image from the generated source, allocates a host port, starts the container, and tracks state.
- The dashboard iframe loads directly from `http://localhost:<hostPort>/` (not via an api proxy) because Next.js's absolute `/_next/static/...` URLs cannot pass through a path-prefix reverse proxy without `basePath` rewrites. URL construction is in [apps/web/lib/api.ts](apps/web/lib/api.ts) `previewIframeUrl()`.
- A `runtimeFeedback` adapter scrapes container logs, classifies issues, and feeds them to the QA agent on subsequent loops as forced criticals.

---

## 12. Memory system — `apps/api/src/storage`

Per-agent JSON memory store rooted at `data/memory/`. Each agent records `decision` / `pattern` / `outcome` entries during `extractLearnings`; relevant entries are loaded on subsequent runs via `formatMemoriesForPrompt`. The `KNOWN_ISSUES_MEMORY` block in [shared.ts](packages/agent-core/src/prompts/shared.ts) (K1–K18) bakes in recurring failure modes so every agent sees the same canonical lessons.

---

## 13. Frontend pipeline UI

[AgentPipeline.tsx](apps/web/components/AgentPipeline.tsx) renders exactly 4 nodes (Spec / Builder / QA / Polish) in execution order. `resolveRole()` maps any historical agent string from older saved sessions onto one of the 4 buckets so old data still renders. WebSocket events drive realtime status: `pipeline:started`, `wave:started`, `step:started`, `step:retrying`, `step:completed`, `step:validated`, `step:repaired`, `step:blocked`, `step:failed`, `step:skipped`, `qa:loop`, `pipeline:completed`, `pipeline:failed`.

---

## 14. Extending the system

To add a new agent role:

1. Add the role to `AgentRole` in [packages/agent-core/src/types.ts](packages/agent-core/src/types.ts) and to the role union in [base-types.ts](packages/agent-core/src/base-types.ts).
2. Register the agent definition (model, I/O schema, memory config, retry policy, dependencies, system prompt) in [agent-registry.ts](packages/agent-core/src/agent-registry.ts).
3. Implement the agent class under `apps/api/src/agents/` extending `BaseAgent`; wire it into [factory.ts](apps/api/src/agents/factory.ts).
4. Add a step entry in `PIPELINE_STEPS` in [pipeline-types.ts](packages/agent-core/src/pipeline-types.ts).
5. Add an input-builder branch in [agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts) so the agent receives only the artifacts it depends on.
6. Add per-role semantic validation in [step-validator.ts](packages/agent-core/src/step-validator.ts).
7. If the agent produces files, extend the merge order in [project-assembler.ts](apps/api/src/pipeline/project-assembler.ts).
8. Run `npx tsc -p apps/api --noEmit` and `npx tsc -p packages/agent-core --noEmit`.

---

## 15. Known constraints

- **Spec is opinionated.** Frontend-only is allowed but the default is fullstack (Next.js + Fastify + Postgres + Prisma). Override via the prompt or the saved `userPreferences`.
- **MAX_QA_LOOPS = 2.** Three total builder runs. Severe specs that need more iterations terminate with the last passing build + a `qaAssurance` report flagging unresolved issues.
- **Anthropic key required for top quality.** With OpenAI alone, `spec` and `qa` fall back to gpt-4o, which is competent but less rigorous than Opus.
- **Preview requires Docker.** Without Docker the dashboard renders source + spec but no live preview iframe.
- **No multi-file streaming.** Builder emits the full file set per pass; large specs (>40 files) push provider context limits — slice mode mitigates this by building incrementally.

---

## 16. Key design principles

1. **One source of truth per concern.** Spec for product intent. `agent-registry.ts` for agent metadata. `pipeline-types.ts` for pipeline order. `ui-foundation.ts` for design system. No drift.
2. **Strict JSON contracts.** Every agent declares its I/O schema; outputs are validated; cross-step invariants are checked; programmatic repair fixes mechanical drift before any LLM re-run.
3. **Determinism where possible, LLM where necessary.** Sanitizers, class rewrites, dependency wiring, design-system injection, static QA checks — all deterministic. Creative work (page layout, copy, code) is the LLM's job.
4. **Fail loud, fail fast.** Validators raise blockers rather than letting bad data flow downstream. Verdict overrides catch LLM rubber-stamping.
5. **The user's prompt is sacred.** The spec expands it generously, but never narrows it. Simplified builds are a critical failure.
