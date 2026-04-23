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

## 0b. Recent changes — Preview system hardening (April 2026)

The frontend-only preview was tightened so it never leaves a blank screen:

### Multi-CDN script loader
[`apps/web/lib/preview-build.ts`](apps/web/lib/preview-build.ts) no longer hard-codes a single `<script src>` per dependency. Each of React, ReactDOM, Babel-standalone, and Tailwind has an ordered fallback chain (`unpkg` → `jsdelivr` → `cdnjs`). A small loader tries each URL in turn and only boots Babel after the critical three (React/ReactDOM/Babel) are confirmed on `window`. If they all fail, the iframe renders a readable "React failed to load" card instead of going blank.

### Empty-root watchdog
After the bootstrap runs and mounts `<App/>`, a 4-second timer checks whether `#root` has any visible children (non-empty text, or any of `img/svg/input/button/a/canvas/video/iframe`). If not, a built-in "Preview placeholder" card is rendered so the iframe is never blank — covers the common case of an app that mounts successfully but renders `null` while waiting on data.

### Path-aware mock layer
[`apps/web/lib/preview-mock-script.ts`](apps/web/lib/preview-mock-script.ts) now infers an **entity type** from the URL (`product`, `order`, `user`, `message`, `post`, `comment`, `notification`, `task`, `project`, `event`, `category`) and returns shape-appropriate mock objects for that entity. Dashboard/stats endpoints return metrics + chart data; health endpoints return `{ status: 'ok' }`; `/:id` endpoints return a single object; list endpoints return the same data under every common envelope (`items` / `data` / `results` / `list` + pagination metadata). `fetch`/`XHR` can never reject.

### Pre-seeded auth session
Before any user code runs, the mock layer seeds the (shimmed) `localStorage` with `token`, `accessToken`, `auth_token`, `authToken`, `jwt`, `user`, `currentUser`, and `auth` keys. Apps that gate rendering on "is there a token?" therefore render their authenticated UI on first paint instead of bouncing to `/login`.

### Error-handling layers (unchanged but documented)
1. Inside the iframe — `window.onerror` + `unhandledrejection` → visible red fallback card.
2. React `PreviewErrorBoundary` around `<App/>` — catches render throws.
3. Host-side React error boundary around the `<iframe>` itself.
4. `usePreviewHtml` never throws — on any failure returns fallback HTML with `status: 'error'`.
5. `buildPreviewHtml` never throws — always returns a valid HTML string.

### Isolation guarantees
Iframe attributes remain `sandbox="allow-scripts allow-forms allow-modals allow-popups"` (no `allow-same-origin`). The iframe runs in an opaque origin, cannot read host cookies/localStorage, cannot contact any backend directly — every fetch/XHR is intercepted and mocked, WebSocket is stubbed to look connected.

---

## 0c. Root-cause pass on the preview transformer (April 2026)

The preview builder previously entered a "fix one error, next project hits a new error" loop. A root-cause audit of [`apps/web/lib/preview-build.ts`](apps/web/lib/preview-build.ts) identified four structural issues and consolidated the fixes:

| # | Root cause | Symptom | Fix |
|---|---|---|---|
| R1 | Module-scope mutable state `__pendingDefaultAliasNames` mutated inside `replace` callbacks, leaked across builds | Phantom `var __dflt_x = Foo;` aliases referencing identifiers that didn't exist → `ReferenceError` after refresh | Moved into `stripModuleSyntax` local scope |
| R2 | Admitted-broken regex for `export default function Foo` (`"tricky to end-match"`) ran BEFORE the correct regex, mangling the source | Malformed function bodies on every project using named default exports | Deleted the broken regex — the subsequent correct transform handles the same pattern |
| R3 | `SERVER_ONLY_IMPORT_RE` filtered files importing `crypto`, `url`, `util`, `events`, `querystring`, `path`, `os`, `stream` | Files silently excluded from bundle if they used any of those identifiers as a bare import | Narrowed the filter to packages with no browser equivalent (kept `fs`, `child_process`, `pg`, etc.; removed browser-safe/ambiguous ones) |
| R4 | **Dominant root cause.** Any `import { Foo } from 'some-lib'` whose package wasn't in our stub list was stripped; the JSX `<Foo />` then referenced an undeclared identifier → `Foo is not defined` → blank screen | Every new UI library in a generated project produced a new "fix, retry, new error" round trip | Added [`injectUniversalStubs`](apps/web/lib/preview-build.ts) — scans the combined source for capital-letter identifiers used in JSX/component/constructor positions, and for anything not declared in the source and not in `PRELUDE_GLOBALS`, emits `var X = __universalStub('X');` |

The `__universalStub(name)` factory returns a `Proxy` over a pass-through React component:
- Renders as JSX: returns children transparently (a `Fragment` wrapping them).
- Arbitrary namespace access: `Dialog.Panel`, `Menu.Item`, etc. all resolve to further universal stubs — never throws.
- Callable as a hook/builder: returns another stub for destructuring/chaining.
- Stringifies to `''`, not thenable — won't hang awaits.

**Consolidation impact**: unknown-library failures no longer trigger a rebuild loop; the app renders with transparent stubs for unknown components while the mock network layer still serves plausible data. The remaining error modes (Babel transpile errors, user-code runtime throws) still surface via the five error-handling layers, but they are genuine bugs in the generated code — not preview-harness faults.

---

## 0d. Frontend SaaS polish pass (April 2026)

The dashboard (`apps/web`) moved from a "dense tooling" aesthetic to a commercial-SaaS baseline. The structural layout (3-column workspace + collapsible logs drawer) is unchanged; the **design system foundation** was upgraded in [apps/web/app/globals.css](apps/web/app/globals.css) and a small set of components lean into the new primitives.

**Design tokens upgraded**:
- Palette: deeper true-dark canvas (`#07090F`), richer elevated surfaces, subtle blue cast
- Brand: new indigo → violet primary (`--brand-1/-2/-3`) with `--brand-grad` and `--brand-grad-soft`
- Elevation: 5-level shadow stack (`--shadow-xs` … `--shadow-xl`) plus dedicated `--shadow-brand`
- Focus: unified `--ring` token (indigo ring + subtle halo); `:focus-visible` applied globally
- Typography: Inter feature settings (`cv02/cv03/cv11/ss01`), tighter tracking, mono with `zero` feature
- Geometry: header 52→56 px, sidebar 260→280 px, right panel 360→380 px
- Motion: unified cubic-bezier easing; reduced-motion query already respected

**Reusable utility classes (appended to [globals.css](apps/web/app/globals.css))**:
| Class | Purpose |
|---|---|
| `.brand-wordmark` + `.brand-wordmark__mark` / `__text` | Branded logo lockup with gradient text clipping |
| `.gradient-text` | Apply the brand gradient to any inline text |
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger` + `.btn--sm` / `.btn--lg` / `.btn--block` | Full button system; `.btn-primary` uses the brand gradient + shadow-brand |
| `.card` / `.card-elevated` | Flat and elevated surfaces; `.card-elevated` includes a highlight top-edge |
| `.avatar` | 28 px gradient avatar tile |
| `.kbd` | Realistic keyboard chip with bottom bevel |
| `.eyebrow` / `.eyebrow--accent` | Uppercase section label |
| `.soft-divider` | Fading hairline divider |
| `.glow-dot` | Pulsing radiant dot for status indicators |
| `.empty-state` + `.empty-state__icon` + `.empty-state__title` | Branded empty-state shell |
| `.input` | Refined text input with hover + focus ring |

**Ambient visual upgrades**:
- App-root now layers three radial brand glows plus a soft grid texture with a radial mask — background feels "deep" rather than flat.
- Scrollbars now 8 px with rounded thumbs that only colour on hover, styled through a padding-clip border trick.
- Primary "Generate" button (`.btn-generate`) repainted in the brand gradient with the multi-stop brand shadow.

**Component-level refinements**:
- [AppHeader.tsx](apps/web/components/AppHeader.tsx) — gradient-text wordmark with a glossy mark tile; account avatar uses `.avatar`; dropdown uses `.card-elevated` and shows a "Signed in" row; "New" button uses `.btn-primary`.
- [Sidebar.tsx](apps/web/components/Sidebar.tsx) — branded "Workspace" eyebrow + project-count chip; primary "New" button is now an accent indigo square; empty state uses the new `.empty-state` shell with a gradient icon tile; active project item has a gradient rail + inset accent line.

No state, wiring, or data-flow contracts changed. Pure presentation upgrade. TypeScript clean on `apps/web`.

---

## 0e. Frontend ↔ backend integration hardening (April 2026)

The frontend now has a **stable integration layer** in [apps/web/lib/api.ts](apps/web/lib/api.ts) that guarantees two invariants:

1. **The frontend never crashes due to backend issues.** Every call tolerates network failure, timeout, HTTP errors, empty bodies, and invalid JSON.
2. **No undefined data reaches the UI.** Every response is passed through a pure normalizer that fills safe defaults for every required field.

### The `ApiError` taxonomy

A single branded error class replaces generic `Error`:

| Kind | Trigger | `isUnreachable` |
|---|---|---|
| `network` | `fetch()` rejected (DNS, CORS, offline, backend down) | ✅ |
| `timeout` | `AbortController` fired after `DEFAULT_TIMEOUT_MS` (20 s) | ✅ |
| `http` | Response `!ok` (4xx / 5xx) — carries `.status` | ❌ |
| `parse` | Body isn't valid JSON | ❌ |

Callers that want to "fall back gracefully when the backend is gone" check `err.isUnreachable`; callers that want to surface real HTTP errors to the user still do.

### Request wrapper contract

- **Hard timeout** via `AbortController` so a hung backend never freezes the UI.
- **Content-type aware parsing**: HTML error pages (`text/html`), empty bodies (`204`), and malformed JSON are all converted into `ApiError` instead of rejecting the promise in a way the UI can't classify.
- **Never resolves to `undefined`**. Empty bodies resolve to `{}` cast to `T`; callers are then responsible for the normalizer step.

### Normalizers

Three pure functions — `normalizeProject`, `normalizeFileEntry`, `normalizeFileContent` — convert the raw JSON into fully-populated domain objects:

- Tolerate legacy field names (`tokensUsed`/`totalTokens`, `costUsd`/`totalCostUsd`, `prompt`/`prompts`).
- Default every numeric field to `0` (so `.toFixed()` never crashes).
- Default every string field to a safe value (`''`, `'Untitled project'`, `new Date().toISOString()`).
- Coerce unknown status values to `'generating'` (safest assumption — UI will show a spinner, not a crash).
- Filter out rows without an `id` so broken DB entries never reach the UI.

### Mock-fallback semantics

Three endpoints return empty/default data when the backend is unreachable (network or timeout only — 4xx/5xx still throw so the user sees real errors):

| Endpoint | Unreachable fallback |
|---|---|
| `listProjects()` | `[]` — dashboard shows welcome/empty state |
| `getProjectFiles(id)` | `[]` — file explorer shows empty state |
| `getProjectFile(id,path)` | `{ path, content: '' }` — file viewer shows empty |
| `getProjectPromptHistory(id)` | `[]` (also on 404) |
| `getProjectVersions(id)` | `[]` (also on 404) |
| `getContainerInfo(id)` | `{ available: false, status: 'unavailable', url: null }` |

The preview layer has its own in-iframe mock network — see section **0b** — so even a project whose files can't be fetched at all still renders a sandbox-mock preview.

### Data-model alignment

Backend [apps/backend/src/routes/projects.ts](apps/backend/src/routes/projects.ts) routes:

| Method | Path | Consumed by |
|---|---|---|
| `POST` | `/api/projects` | `generateProject` |
| `GET`  | `/api/projects` | `listProjects` |
| `GET`  | `/api/projects/:id/files` | `getProjectFiles` |
| `GET`  | `/api/projects/:id/file?path=` | `getProjectFile` |
| `POST` | `/api/projects/:id/prompts` | `updateProject` |
| `GET`  | `/api/projects/:id/prompts` | `getProjectPromptHistory` |
| `GET`  | `/api/projects/:id/versions` | `getProjectVersions` |
| `POST` | `/api/projects/:id/versions/:v/restore` | `restoreProjectVersion` |
| `GET`  | `/api/projects/:id/container` | `getContainerInfo` |
| `GET`  | `/api/projects/:id/export` | `exportProject` (blob download, not JSON) |
| `GET`  | `/api/sessions/:id/progress` | `getSessionProgress` |
| `WS`   | `/ws/session/:id` | `openSessionSocket` |

TypeScript contracts live in [apps/web/types/dashboard.ts](apps/web/types/dashboard.ts) and are the single source of truth consumed by the store, components, and API client.

### Outcome

- A completely offline backend: dashboard loads, shows empty state, never crashes. Preview still works (synth mode with in-iframe mocks).
- A backend returning partial rows (missing `totalTokens`, legacy `prompt` string, etc.): rows normalize and render correctly.
- A backend returning malformed JSON: converted into an `ApiError('parse')`, bubbled to the toast system instead of an uncaught promise rejection.
- A backend 4xx/5xx: still surfaced via toasts so real product bugs aren't silenced.

---

## 0f. Self-healing pipeline — post-step validation + programmatic repair (April 2026)

The orchestrator now has a **validate-and-repair gate** between every step's completion and the emission of `step:completed`. The rule enforced here is the user's standing rule: **the pipeline must NOT proceed if errors exist**.

### Where it lives

- New module: [packages/agent-core/src/step-validator.ts](packages/agent-core/src/step-validator.ts) — pure, deterministic, no LLM calls.
- Wired into [packages/agent-core/src/orchestrator.ts](packages/agent-core/src/orchestrator.ts) inside `runWaveStep` immediately after `task.status === 'completed'`.

### What runs after every step

1. **Schema validation** — driven by the `output.schema` declared for each agent in [packages/agent-core/src/agent-registry.ts](packages/agent-core/src/agent-registry.ts). Every `required: true` field is checked for presence + correct type. Missing required fields are auto-filled with empty safe defaults (`[]`, `{}`, `''`, `0`, `false`). Wrong-shape fields are coerced to the declared type.
2. **Per-role semantic validation** — cross-step invariants encoded per agent:
   - `intent_expander` — `expandedPrompts[]` must be non-empty; otherwise **blocker**.
   - `planner` — `tasks[]` non-empty; synthesize `task.id` when missing.
   - `architect` — `fileTree[]` non-empty; strip entries with no path.
   - `developer` — `files[]` non-empty (else blocker); strip entries missing `path`; coerce missing `content` to `''`; detect **schema drift** against `architect.fileTree` — if overlap <40%, emit a deferred issue `fixableBy: 'reviewer'`.
   - `reviewer` — flag score <50 or any `critical` issues as a **deferred error** with `fixableBy: 'debugger'`; normalize `passable` boolean.
   - `tester` — coerce `testFiles[]` and `coverage{}` shapes.
   - `debugger` — if reviewer had issues but the debugger emitted zero patches AND zero unresolved, forward the reviewer's issues into `unresolved` so `quality_enforcer` still sees them (prevents information loss).
   - `quality_enforcer` — normalize `verdict` to `'pass' | 'needs-improvement'`; flag UI score <50 as `ui-broken` error with `fixableBy: 'quality_enforcer'`; surface critical findings.
   - `optimizer`, `devops` — coerce shapes.

### Verdict taxonomy

Every step now produces one of four verdicts:

| Verdict | Meaning | Pipeline action |
|---|---|---|
| `ok` | No issues, no repairs. | Proceed. |
| `repaired` | Issues existed but were all auto-fixed in-place. | Proceed with repaired artifact. |
| `deferred` | Errors exist but a downstream agent can fix them (e.g. reviewer found issues → debugger will handle). | Proceed; log warn. |
| `blocked` | Unrepairable, no downstream agent can fix. | **Halt pipeline**, emit `pipeline:failed`. |

### Repair strategy (no extra LLM calls)

Repairs are programmatic and deterministic to keep self-heal free and fast (<10 ms per step). Pattern:

- **Fill defaults** for missing required fields.
- **Coerce shapes** when the agent returned the wrong type (array vs. object, etc.).
- **Remove invalid entries** (e.g. file entries with no path).
- **Align schemas** across steps (e.g. forward reviewer issues into debugger's `unresolved` when the debugger dropped them).
- **Defer to downstream** — for problems that a later LLM agent is designed to handle, we don't re-invoke here; we just mark and log.

The stored artifact is always the **repaired** output, so downstream agents see clean data.

### New events

The `PipelineEvent` union gained three variants (backwards compatible — consumers that don't switch on these just ignore them):

| Event | Emitted when |
|---|---|
| `step:validated` | After every step. Carries `verdict`, `issueCount`, `repairCount`, `issues[]`. |
| `step:repaired` | When at least one auto-repair was applied. Carries the `changes[]` (path, action, detail). |
| `step:blocked` | When `verdict === 'blocked'` — the pipeline is about to halt. |

`StepState` also gained `validationVerdict` and `repairCount` fields for UI consumption.

### Hard-stop guarantee

When the validator returns `blocked`:

1. The step is marked `failed`.
2. `step:blocked` + `step:failed` are emitted.
3. `state.status = 'failed'` immediately.
4. `pipeline:failed` is emitted with a descriptive reason.
5. No downstream wave runs.

This means a broken intent, an empty plan, an empty file tree, or zero developer files can **never** reach the user.

---

## 0g. Final QA gate — low-quality outputs are blocked (April 2026)

The step-validator in §0f enforces correctness at each agent boundary. This section adds a **final, full-codebase QA gate** that runs after `assembleProject()` and before a project is ever marked `completed`. It implements the user's rule: _"prevent low-quality outputs from being accepted"_.

### Where it lives

- New module: [apps/api/src/pipeline/quality-assurance.ts](apps/api/src/pipeline/quality-assurance.ts) — pure, deterministic, LLM-free.
- Wired into both [apps/api/src/pipeline/project-generator.ts](apps/api/src/pipeline/project-generator.ts) and [apps/api/src/pipeline/project-updater.ts](apps/api/src/pipeline/project-updater.ts) immediately after the project is assembled.
- Results are persisted on the `ProjectRecord` in a new `qaAssurance` field (see [apps/api/src/storage/project-store.ts](apps/api/src/storage/project-store.ts)).

### The five quality bars

| Bar | What it checks |
|---|---|
| **ui-modern** | Frontend has `.tsx`/`.jsx` files; uses a styling system (Tailwind / CSS Modules / styled-components / any CSS); at least one page/route component; no suspiciously-short stub components. |
| **layout-structure** | Next.js App Router has `app/layout.tsx`; Pages Router has `_app.tsx`; Vite has `src/main.tsx` + `index.html`; non-framework frontends have an HTML shell. |
| **functional-e2e** | Every `fetch()` / `axios` call in the frontend maps to a backend route (`:param` / `[param]` / `*` wildcards respected). Backend has at least one registered route. |
| **preview-renders** | Every code file has balanced parens/braces/brackets, no unterminated strings, no unterminated block comments. Cheap syntactic sanity check catches truncated LLM output. |
| **no-placeholders** | No `// TODO: implement me`, `throw new Error('Not implemented')`, `/* implement me */`, `FIXME: implement`, Lorem ipsum, or `<!-- TODO -->` remnants. |

### Auto-repair (no extra LLM calls)

Before failing a project, the gate applies deterministic fixes for issues it knows how to correct:

- Strip `// TODO: implement me` and replace with a "review before production" marker.
- Replace `throw new Error('Not implemented')` with `return null; // auto-patched`.
- Inject a baseline `app/layout.tsx` when a Next App Router project is missing one.
- Inject a baseline `src/main.tsx` + `index.html` when a Vite project is missing them.

Auto-fixed issues are recorded on the QA report but no longer count as blockers.

### Scoring

After repair, each bar is scored 0–100: `-50 per blocker`, `-20 per error`, `-5 per warning`. The overall `qaAssurance.score` is the mean of the five bars. A bar `passed` when it has zero unrepaired blockers and zero unrepaired errors.

### Hard-stop guarantee

If `qaAssurance.passed === false` after repair:

1. The project's `status` is set to `'failed'` (never `'completed'`).
2. The `GenerateResult.success` / `UpdateResult.success` is `false`.
3. `error` on the result surfaces the first blocker message.
4. The full `qaAssurance` payload (score, per-bar detail, blockers, notes) is persisted so the UI can show the user exactly what went wrong.

Combined with §0f this gives a two-layer defence: the step-validator blocks bad agent output during execution, and the QA gate blocks bad _final_ output before it ever reaches the user.

---

## 1. System overview

DEVteam is a **multi-agent AI platform** that turns a natural-language prompt into a runnable fullstack application. It is a **Turborepo monorepo of TypeScript/Node.js packages**. A Fastify backend drives a 10-stage agent pipeline; a Next.js frontend renders real-time progress, an in-browser preview, and export.

```
┌──────────────────────────────────────────────────────────────────┐
│                  apps/web  (Next.js 16, :3000)                   │
│  ProjectList · PromptPanel · AgentPipeline · FileViewer ·        │
│  LivePreview · LogsPanel · PhaseProgress · ShowcasePanel ·       │
│  TemplateGallery · KeyboardShortcuts · ToastStack                │
└────────────────────────────┬─────────────────────────────────────┘
                             │  REST + WebSocket  (NEXT_PUBLIC_API_BASE)
┌────────────────────────────▼─────────────────────────────────────┐
│                    apps/api  (Fastify, :3001)                    │
│  routes/   api · llm-routes · version-routes · websocket         │
│  pipeline/ project-generator · project-updater · project-assembler│
│            quality-assurance (§0g) · session-manager             │
│  agents/   factory + 10 BaseAgent subclasses                     │
│  llm/      smart-router · anthropic-client · openai-client       │
│            cost-tracker · circuit breaker                        │
│  storage/  ProjectStore · FileMemoryStore · LearningEngine       │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│              packages/agent-core  (canonical framework)          │
│  PipelineOrchestrator   · wave-based parallel execution          │
│  step-executor          · retry + cache + timeout                │
│  step-validator (§0f)   · post-step validation + auto-repair     │
│  agent-registry         · AGENT_DEFINITIONS (10 agents)          │
│  agent-input-builder    · enforces "only intent_expander sees    │
│                            raw prompts" contract                 │
│  base-agent · agent-runner · agent-chains · agent-memory-ops ·   │
│  agent-metrics · agent-middleware · message-bus · prompts        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                  ┌──────────┴───────────┐
                  ▼                      ▼
              OpenAI                Anthropic  (+ Google / Gemini)
```

### Repository layout

| Path | Purpose |
|---|---|
| [apps/web](apps/web/) | **Production frontend** — Next.js 16, React 19, Tailwind, Zustand, Framer Motion. The polished SaaS dashboard (see §0d). |
| [apps/api](apps/api/) | **Production backend** — Fastify 3001. Hosts the 10-agent factory, the pipeline orchestrator wiring, storage, and the final QA gate (§0g). |
| [packages/agent-core](packages/agent-core/) | **Canonical agent framework** — agent registry, base class, orchestrator, step executor, step-validator (§0f), pipeline types, event model, prompt system, metrics. |
| [core](core/) | Shared primitives — config loader, logger, error classes, core types. |
| [services/](services/) | Legacy service packages (`agents`, `api-routing`, `memory`, `orchestration`) retained for an alternate backend (`apps/backend`) and reusable as libraries. New work happens in `packages/agent-core` + `apps/api`. |
| [apps/backend](apps/backend/) | Alternate backend wrapping `services/*`. Kept for backwards compatibility with existing docker-compose deployments. |
| [apps/frontend](apps/frontend/) | Minimal legacy frontend preserved for reference. The production UI is `apps/web`. |
| [infrastructure/](infrastructure/) | Dockerfiles (backend + frontend), CI deploy workflow, deploy scripts. |
| [tests/](tests/) | Jest unit tests across `agents`, `core`, `memory`. |

### Layer responsibilities

| Layer | Path | Responsibility |
|---|---|---|
| Frontend | `apps/web` | Prompt UI, project list, pipeline visualisation, file viewer, in-browser preview, export download, toast + keyboard shortcuts. Crash-proof integration layer (§0e). |
| Backend | `apps/api` | REST + WebSocket, project persistence, export builder, preview renderer, pipeline orchestration + QA gate (§0g). |
| Agent framework | `packages/agent-core` | Agent definitions, orchestrator, step executor, validator/repair (§0f), input builder, message bus, metrics, memory ops. |
| LLM routing | `apps/api/src/llm` | Multi-provider router (Anthropic, OpenAI, Google). Retry with jitter, circuit breaker per provider, per-request cost tracking, budget guard. |
| Storage | `apps/api/src/storage` | `ProjectStore` (JSON on disk at `data/projects`), `FileMemoryStore` (short- + long-term memory), `LearningEngine` (success/failure patterns). |
| Core | `core/` | Shared config loader, error classes, logger, time/id helpers. |

---

## 2. The 10-stage agent pipeline

The canonical pipeline lives in [packages/agent-core/src/pipeline-types.ts](packages/agent-core/src/pipeline-types.ts) as `PIPELINE_STEPS` and is executed by [PipelineOrchestrator](packages/agent-core/src/orchestrator.ts) in **dependency-ordered waves** — agents whose dependencies are satisfied run in parallel via `Promise.allSettled`.

```
prompt
   │
   ▼
┌──────────────────────┐
│ 1. intent_expander   │  Expands vague prompts → full product spec
└──────────┬───────────┘  (features, uiExpectations, qualityStandards,
           │              constraints, nonGoals, assumptions).
           │              THE ONLY agent that sees session.prompts.
           ▼
┌──────────────────────┐
│ 2. planner           │  Structured task list, priorities,
└──────────┬───────────┘  dependencies, stack hints.
           ▼
┌──────────────────────┐
│ 3. architect         │  fileTree[], dbSchema, apiContracts[],
└──────────┬───────────┘  components[], envVars[], techStack.
           ▼
┌──────────────────────┐
│ 4. developer         │  Generates every source file
└──────────┬───────────┘  (can run in parallel across file sets;
           │              maxConcurrency: 4).
           ▼
┌──────────────────────┐
│ 5. reviewer          │  Scores code 0–100; issues[] with severity,
└──────────┬───────────┘  suggestedFix, file, line; passable flag.
           ▼
┌──────────────────────┐
│ 6. tester            │  testFiles[] + coverage map.
└──────────┬───────────┘  (Runs in the same wave as debugger.)
           ▼
┌──────────────────────┐
│ 7. debugger          │  patches[] fixing reviewer issues;
└──────────┬───────────┘  unresolved[] forwarded downstream.
           ▼
┌──────────────────────┐
│ 8. quality_enforcer  │  scores{ui, functional, code, consistency}
└──────────┬───────────┘  ∈ 0–100; verdict='pass'|'needs-improvement';
           │              patches[] + newFiles[] for failing dimensions.
           ▼
┌──────────────────────┐
│ 9. optimizer         │  patches[] for perf/bundle/query/cache;
└──────────┬───────────┘  recommendations[] for manual review.
           ▼
┌──────────────────────┐
│ 10. devops           │  files[]: Dockerfile, docker-compose,
└──────────┬───────────┘  CI workflow, .env.example.
           │
           ▼
  assembleProject()   ─►  §0g QA gate  ─►  ProjectRecord (status=completed | failed)
```

### Wave execution

`PipelineOrchestrator.execute()`:

1. Builds `PipelineState.steps[]` — one `StepState` per step (pending/running/completed/failed/skipped, attempt, maxAttempts, durationMs, validationVerdict, repairCount).
2. Loops forming **waves** — every iteration picks the set of steps whose `AGENT_DEFINITIONS[role].dependencies` are all resolved. Emits `wave:started` with the agent list.
3. Runs the wave via `Promise.allSettled(wave.map(runWaveStep))`. Independent agents (e.g. tester + debugger after developer) run concurrently.
4. Any step whose upstream dependency never completes is emitted as `step:skipped` after the last wave.

### Per-step execution (`runWaveStep`)

1. `executeStep()` — cache lookup on SHA-256 of `{role, input}`; on hit, synthesize a completed Task at zero cost. On miss: retry loop (`policy.maxAttempts`), per-call timeout, exponential backoff with 25% jitter, provider circuit-breaker aware.
2. On success, the step goes through the **self-heal gate** (§0f) — `validateAndRepair()` applies schema + semantic checks, fills defaults, coerces shapes, aligns cross-step invariants. The stored artifact is the repaired output. Verdicts: `ok` / `repaired` / `deferred` / `blocked`. A `blocked` verdict hard-stops the pipeline.
3. Events emitted (typed in `PipelineEvent`): `step:started`, `step:retrying`, `step:validated`, `step:repaired` (if any), `step:blocked` (if blocked), `step:completed` or `step:failed`.

### Step caching

Every step result is cached in-memory with a 30-minute TTL keyed by `sha256({role, input})`. A subsequent identical invocation within TTL replays the cached output at zero cost. Counted in `PipelineState.optimization` (`cacheHits`, `cacheMisses`, `estimatedApiCallsSaved`).

### Update pipeline (follow-up prompts)

[project-updater.ts](apps/api/src/pipeline/project-updater.ts) supports three scopes:

| Scope | Re-runs |
|---|---|
| `code` | developer → reviewer → tester → debugger → quality_enforcer → optimizer (reuses planner + architect) |
| `design` | architect onward (reuses planner) |
| `full` | Full 10-stage pipeline, same as a fresh generate |

Seeded artifacts (`planner`, `architect`, etc.) are passed as `seedArtifacts` so the orchestrator marks those steps as already-complete and only the downstream waves execute. Versions are snapshotted in `ProjectRecord.versionHistory` with file diffs.

---

## 3. Agent roster — inputs and outputs

All 10 agents are declared in [agent-registry.ts](packages/agent-core/src/agent-registry.ts) (`AGENT_DEFINITIONS`). Each entry carries: `role`, `name`, `description`, `model` + `fallbackModel`, `input.schema`, `output.schema`, `systemPrompt`, `memoryConfig`, `maxConcurrency`, `timeoutMs`, `retryPolicy`, `dependencies`. Implementations live in [apps/api/src/agents/](apps/api/src/agents/).

| # | Role | Model | Input (required fields) | Output (required fields) | Deps |
|---|---|---|---|---|---|
| 1 | `intent_expander` | Sonnet · fb GPT-4o | `prompts[]` | `productName, productCategory, oneLiner, targetUsers[], expandedPrompts[], features{core,standard,stretch}, uiExpectations, qualityStandards` | — |
| 2 | `planner` | Sonnet 4K · fb GPT-4o | `prompts[]` (expanded), `expandedSpec?` | `projectName, summary, tasks[], constraints[], stackHints` | intent_expander |
| 3 | `architect` | Opus · fb GPT-4o | `plan, expandedSpec?` | `fileTree[], dbSchema, apiContracts[], components[], envVars[], techStack` | planner |
| 4 | `developer` | Sonnet · fb GPT-4o | `spec, fileAssignment[], context?` | `files[] { path, content, language }` | architect |
| 5 | `reviewer` | Opus 4K · fb GPT-4o | `spec, files[]` | `issues[], score, passable, summary` | developer, architect |
| 6 | `tester` | Sonnet 8K · fb GPT-4o-mini | `files[], apiContracts[], spec, reviewIssues?` | `testFiles[], coverage` | developer |
| 7 | `debugger` | Sonnet 6K · fb GPT-4o | `issues[], affectedFiles[], testResults?, spec?` | `patches[] { file, oldContent, newContent, explanation }, unresolved[]` | reviewer |
| 8 | `quality_enforcer` | Opus · fb GPT-4o | `expandedSpec, files[], spec?, reviewReport?, unresolvedIssues?` | `scores, verdict, findings[], patches[], newFiles?, summary` | developer, reviewer |
| 9 | `optimizer` | Sonnet 6K · fb GPT-4o-mini | `files[], spec, qaReport?, unresolvedIssues?` | `patches[], recommendations[], perfEstimate` | developer |
| 10 | `devops` | GPT-4o-mini · fb Haiku | `spec, fileTree[], generatedFiles?` | `files[]` | architect |

### Input-builder contract

[agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts) is the **only** place that constructs agent inputs from the shared `state.artifacts` map. The contract it enforces:

- Only `intent_expander` sees `session.prompts` (the raw user text).
- Every other agent receives `prompts = expandedPrompts` and `expandedSpec` from the intent_expander artifact — never the raw prompts.
- Each agent's dependency set (declared in `AGENT_DEFINITIONS[role].dependencies`) matches exactly what the builder puts in its input.

This is what makes the pipeline composable: downstream agents always work from a single source of truth (the expanded spec), and the orchestrator can wave-execute independent agents without risking divergent interpretations of the user request.

### File merge order

[project-assembler.ts](apps/api/src/pipeline/project-assembler.ts) merges artifacts into the final file set deterministically:

```
developer.files
  → devops.files
  → tester.testFiles
  → debugger.patches         (applied via substring replace)
  → reviewer.patches         (rare — most reviewers emit issues, not patches)
  → quality_enforcer.newFiles + quality_enforcer.patches
  → optimizer.patches
  → ensureDeploymentReadiness()
  → injectUIFoundation()
```

The result then goes through the §0g **QA gate** before being persisted.

### Agent base class

[BaseAgent](packages/agent-core/src/base-agent.ts) is the abstract runtime every agent extends. Its `execute(task, ctx)` method:

1. Loads memories (`memoryConfig.shortTerm` and/or `longTerm` via [agent-memory-ops.ts](packages/agent-core/src/agent-memory-ops.ts)).
2. Builds the prompt (system prompt + examples + memory block + input payload).
3. Calls the LLM router with the agent's primary `model`, falling back to `fallbackModel` on provider failure / circuit-open.
4. Parses + validates the JSON output against `output.schema`.
5. Records memory outcomes, metrics (tokens, cost, latency), and returns a `Task` with `status` and `output`.

Middleware is composable (`agent-middleware.ts`): logging, timeout, input validation, rate limiting, retry, metrics, and cost.

---

## 4. Orchestration flow

### Entry points (apps/api routes)

| Method | Path | Flow |
|---|---|---|
| `GET`  | `/api/health` | Liveness + config sanity check |
| `POST` | `/api/projects` | Create project + start pipeline (202 Accepted, runs async) |
| `GET`  | `/api/projects` | List all projects |
| `GET`  | `/api/projects/:id` | Fetch project state (status, files[], pipeline snapshot, qaReport, qaAssurance) |
| `GET`  | `/api/projects/:id/files` | File tree only |
| `GET`  | `/api/projects/:id/file` | Single file contents (`?path=…`) |
| `POST` | `/api/projects/:id/prompts` | Queue follow-up prompt (409 if already running) |
| `GET`  | `/api/projects/:id/prompts` | Prompt history |
| `GET`  | `/api/projects/:id/versions` | Version snapshots |
| `GET`  | `/api/projects/:id/preview` | In-browser preview HTML |
| `GET`  | `/api/projects/:id/export` | Stream ZIP with README, .env.example, .gitignore |
| `GET`  | `/api/projects/:id/container` | Container session info for runtime preview |
| `GET`  | `/api/sessions/:id/progress` | Polling snapshot of pipeline progress |
| `WS`   | `/ws/session/:id` | Realtime `pipeline:*`, `wave:*`, `step:*`, `step:validated`, `step:repaired`, `step:blocked` events |

### Orchestrator class

[`PipelineOrchestrator`](packages/agent-core/src/orchestrator.ts) owns an `AgentRegistry` (factories for all 10 agents from [apps/api/src/agents/factory.ts](apps/api/src/agents/factory.ts)), an LLM router, a memory store, and the message bus. Public surface:

```ts
class PipelineOrchestrator {
  constructor(deps: {
    registry: AgentRegistry;
    llmRouter: LLMRouter;
    memoryStore: MemoryStore;
    bus: MessageBus;
    costTracker: CostTracker;
  });

  // Full 10-stage run
  execute(session: SessionContext, input: { prompts: string[] }): Promise<PipelineState>;

  // Seeded run — reuses upstream artifacts so only downstream waves execute
  executeWithSeed(
    session: SessionContext,
    input: { prompts: string[] },
    seedArtifacts: Partial<Record<AgentRole, Record<string, unknown>>>,
  ): Promise<PipelineState>;
}
```

### Generate vs update pipelines

- **Generate** — [project-generator.ts](apps/api/src/pipeline/project-generator.ts) calls `execute()` for the full 10-stage pipeline, then `assembleProject()` merges files (§3), then `runQualityAssurance()` (§0g) is applied as the final gate.
- **Update** — [project-updater.ts](apps/api/src/pipeline/project-updater.ts) seeds `planner` + `architect` from the previous run and uses `executeWithSeed()` so only `developer → reviewer → tester → debugger → quality_enforcer → optimizer` re-run for a code-scope update. A `design`-scope update re-runs from `architect` down, and a `full`-scope update starts fresh. Versions snapshot into `ProjectRecord.versionHistory` with a file diff.

### Concurrency safety

`POST /api/projects/:id/prompts` rejects with **409 Conflict** when `project.status === 'running'`, surfacing the live `sessionId` for the client to attach to. This prevents two pipelines from racing on the same artifact set.

---

## 4a. Project state structure

The source of truth persisted to disk is the `ProjectRecord` (see [apps/api/src/storage/project-store.ts](apps/api/src/storage/project-store.ts)). The transient object driving the pipeline is the `PipelineState` (see [packages/agent-core/src/pipeline-types.ts](packages/agent-core/src/pipeline-types.ts)).

```ts
interface ProjectRecord {
  id: string;
  sessionId: string;
  name: string;
  prompts: string[];                       // full prompt history (prompt[0] = initial, prompt[n] = follow-ups)
  status: 'pending' | 'running' | 'completed' | 'failed';
  files: ProjectFile[];                    // final merged file set (post-assembler, post-QA)
  spec?: ProjectSpec;                      // architect fileTree + apiContracts + envVars
  plan?: ProjectPlan;                      // planner tasks
  expandedSpec?: ExpandedSpec;             // intent_expander full output
  qaReport?: QAReport;                     // reviewer + tester summary
  qualityReport?: QualityReport;           // quality_enforcer scores + verdict
  qaAssurance?: {                          // §0g final QA gate output
    passed: boolean;
    score: number;
    autoFixCount: number;
    bars: QABarResult[];
    blockers: string[];
  };
  tasks: PlannedTask[];
  totalTokens: number;
  totalCostUsd: number;
  optimization: OptimizationMetrics;       // cacheHits, cacheMisses, apiCallsSaved
  durationMs: number;
  version: number;
  versionHistory: VersionSnapshot[];       // { version, sessionId, changedFiles[], createdAt }
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface PipelineState {
  sessionId: string;
  projectId: string;
  status: 'running' | 'completed' | 'failed';
  input: { prompts: string[] };
  steps: StepState[];                      // one per AgentRole: status, attempt, durationMs,
                                           //                    validationVerdict, repairCount
  currentWave: number;
  artifacts: Map<AgentRole, Record<string, unknown>>;  // typed outputs keyed by role
  totalTokens: number;
  totalCostUsd: number;
  optimization: OptimizationMetrics;
  error?: { role?: AgentRole; message: string };
}
```

### How state evolves

1. `POST /api/projects` creates a `ProjectRecord` with `status='pending'`, empty `files[]`, and kicks off the pipeline asynchronously. A 202 is returned with the `sessionId` so the client can attach to `/ws/session/:id`.
2. As each wave completes, the orchestrator:
   - writes the agent's validated output into `PipelineState.artifacts[role]`,
   - updates `StepState` (attempt, durationMs, validationVerdict, repairCount),
   - emits `step:completed` (+ optionally `step:validated` / `step:repaired`),
   - accumulates `totalTokens` / `totalCostUsd`.
3. After the last wave, [project-assembler.ts](apps/api/src/pipeline/project-assembler.ts) merges all file-emitting artifacts into a single path-keyed file map (§3 merge order).
4. [quality-assurance.ts](apps/api/src/pipeline/quality-assurance.ts) (§0g) runs auto-repairs and scores the 5 bars. Its report is written to `qaAssurance`.
5. The project is persisted with `status='completed'` **only if** `pipelineState.status==='completed' && qaAssurance.passed`. Otherwise it becomes `failed` with an error and the partial artefacts are preserved for debugging.
6. For follow-up prompts (`POST /:id/prompts`), the update orchestrator (§4) seeds the earlier artifacts and runs only the downstream waves. A new `VersionSnapshot` is appended to `versionHistory` with the changed-file diff.

Agents never see the full `ProjectRecord`. [agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts) extracts the exact typed slice each agent needs (see §3 "Input-builder contract"), keeping the agent contract narrow and the state surface auditable.

---

## 5. LLM routing (`apps/api/src/llm`)

### Router responsibilities

[router / smart-router.ts](apps/api/src/llm/smart-router.ts) is the single entry point agents use. For each request it:

1. **Selects a model** from the agent's `AGENT_DEFINITIONS[role].model`, with `fallbackModel` as backup.
2. **Executes with retry** — exponential backoff with jitter (250ms × 2^attempt + random jitter, capped at 8s), up to `policy.maxAttempts` attempts.
3. **Classifies retriable errors**: retries on 429, 5xx, network, timeout, "overloaded"; fails fast on 401/403/4xx.
4. **Records circuit-breaker outcome** per provider — opens after consecutive failures and routes to the fallback provider until the breaker half-opens.
5. **Tracks cost** via [cost-tracker.ts](apps/api/src/llm/cost-tracker.ts) per request (input + output tokens × provider rate).
6. **Enforces monthly budget** when `MONTHLY_BUDGET_USD` is configured (guard runs before each call).

### Model routing table (defaults)

Configured via `AGENT_DEFINITIONS` in [packages/agent-core/src/agent-registry.ts](packages/agent-core/src/agent-registry.ts). Overridable per-agent by env var `MODEL_<ROLE>` (e.g. `MODEL_PLANNER=gpt-4o-mini`).

| Role | Default model | Fallback | Rationale |
|---|---|---|---|
| `intent_expander` | claude-3-5-sonnet | gpt-4o | Product-spec expansion — strong reasoning, structured JSON |
| `planner` | claude-3-5-sonnet | gpt-4o | Task decomposition + dependency graph |
| `architect` | claude-3-opus | gpt-4o | fileTree + apiContracts + schema — highest-stakes structural decision |
| `developer` | claude-3-5-sonnet | gpt-4o | Large multi-file codegen |
| `reviewer` | claude-3-opus | gpt-4o | Code critique; Opus consistently best |
| `tester` | claude-3-5-sonnet | gpt-4o-mini | Templated test generation |
| `debugger` | claude-3-5-sonnet | gpt-4o | Targeted patch synthesis from issue list |
| `quality_enforcer` | claude-3-opus | gpt-4o | Holistic UI/functional scoring, gate decision |
| `optimizer` | claude-3-5-sonnet | gpt-4o-mini | Pattern-replace style rewrites |
| `devops` | gpt-4o-mini | claude-3-haiku | Boilerplate-heavy; cheapest model is sufficient |

---

## 6. Memory system (`apps/api/src/storage`)

Current implementation is **file-based** (JSON per `agentRole`) via [FileMemoryStore](apps/api/src/storage/). The `MemoryStore` interface has a planned Postgres+pgvector implementation but is not yet wired.

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

[apps/api/src/routes/export-builder.ts](apps/api/src/routes/export-builder.ts) (with a parallel implementation in [apps/backend/src/routes/export-builder.ts](apps/backend/src/routes/export-builder.ts) for the legacy backend) produces a ZIP with:

- All real source files (no mocks, no preview stubs)
- `README.md` — generated via `detectTechStack()` which inspects file contents (not planner claims) to identify frontend (Next/React/Vue/Angular/Svelte), backend (FastAPI/Flask/Django/NestJS/Fastify/Express/Koa/Hono/Go/Rust), database (Prisma/Sequelize/TypeORM/Drizzle/pg/Mongoose/SQLAlchemy), and test framework. Install + dev-server steps are switched per-stack (`npm install`/`pip install -r requirements.txt`, `npm run dev`/`uvicorn`)
- `.env.example` — extracted from actual `process.env.X` usage in the code
- `.gitignore` — language-appropriate
- Any Dockerfile / compose / CI files produced by the DevOps agent

Path safety: every entry is validated to reject `..` traversal and absolute paths (enforced at `DeveloperAgent` output validation and again at zip time).

---

## 9. Error handling and self-healing

| Failure mode | Where handled | Behaviour |
|---|---|---|
| LLM 429 / 5xx / network | `router.executeWithRetry` | Exponential backoff + jitter, up to 3 attempts |
| LLM auth error | `router.executeWithRetry` | Fail fast, no retry |
| Provider sustained failure | `CircuitBreaker` | Opens breaker, routes to fallback provider |
| Invalid agent JSON | `BaseAgent` schema validation | Throws `ValidationError`; step-level retry honouring `retryPolicy.maxAttempts` |
| Missing path / path traversal in developer output | Developer output validator | Silently drops bad entries; fails if zero valid files remain |
| Malformed / low-quality agent output | `step-validator.ts` (§0f) | Deterministic auto-repair: fills defaults, coerces shapes, aligns cross-step invariants. Emits `step:repaired`; on unresolvable failure emits `step:blocked` and halts the pipeline |
| Assembled project has blockers (missing entry, placeholders, broken imports) | `quality-assurance.ts` (§0g) | Auto-repairs where possible; fails the run if any blocker remains |
| Concurrent prompt on running project | `POST /:id/prompts` | Returns 409 with in-flight `currentSessionId` |
| Reviewer flags critical/major issues | `DebuggerAgent` step | Automatically fixes or flags as `remainingIssues` |
| Optimizer makes things worse | Orchestrator merge logic | Test files are never touched; unchanged-by-optimizer source files are preserved |
| Pipeline crashes mid-run | Orchestrator try/catch | `status=failed`, saves partial artifacts, emits `session.failed`, surfaces `error` on project |

There is no periodic sweeper for stuck sessions — a crashed process leaves `status=running` projects that the user must manually retry. This is a known limitation.

---

## 10. Observability

- Every agent logs via `Logger('agent:<role>')` with sessionId, durationMs, tokens, costUsd.
- Every pipeline run emits `pipeline:*`, `wave:*`, and `step:*` events over WebSocket (including `step:validated`, `step:repaired`, `step:blocked` from §0f). Consumed by [apps/web/components/AgentPipeline.tsx](apps/web/components/AgentPipeline.tsx) and [PhaseProgress](apps/web/components/PhaseProgress.tsx).
- Cost + tokens accumulate on `PipelineState.totalCostUsd` / `totalTokens` and are copied into `ProjectRecord.totalCostUsd` / `totalTokens`.
- Per-agent metrics (latency, success rate, avg tokens) live in [agent-metrics.ts](packages/agent-core/src/agent-metrics.ts).
- Learning signals feed back into [LearningEngine](apps/api/src/storage/learning-engine.ts) for future prompt conditioning.

---

## 11. Key design principles (what we actually do)

1. **One pipeline, one artifacts map.** `PipelineState.artifacts` (a `Map<AgentRole, output>`) is the single source of truth in-flight; `ProjectRecord` is the durable projection. Agents see only the typed slice the input-builder constructs — never the whole state.
2. **Only the intent_expander sees raw prompts.** Every other agent consumes the expanded spec. This is enforced in [agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts) and is what keeps 10 agents interpreting the same request consistently.
3. **Wave-based parallelism.** Independent agents (tester + debugger after developer; optimizer + devops towards the end) run concurrently via `Promise.allSettled`. The dependency DAG is declared in `AGENT_DEFINITIONS`.
4. **JSON-only agent outputs, validated twice.** Every agent returns strict JSON validated against its output schema. Then §0f runs deterministic semantic checks + auto-repair. Then §0g runs a whole-project QA gate.
5. **No step proceeds with known-broken output.** Self-heal (§0f) blocks the pipeline on unfixable errors rather than letting a downstream agent poison the run.
6. **Retry at the right layer.** Transient LLM failures retry in the router. Schema failures retry at the step. Semantic failures trigger deterministic repair, not another LLM call.
7. **Preview is deterministic.** No backend execution, no user state. Same files → same HTML.
8. **Export is trustworthy.** README is based on what the code actually is, not what the planner claimed. `.env.example` comes from real `process.env` references.
9. **Cost-aware by default.** Opus only on architect + reviewer + quality_enforcer. Haiku/Mini on devops and optimizer. Step caching reuses identical (role, input) hashes within a 30-min TTL.

---

## 12. Directory reference

```
dev1/
├── apps/
│   ├── api/                           # Canonical backend — Fastify :3001
│   │   └── src/
│   │       ├── app.ts / server.ts
│   │       ├── config.ts / logger.ts
│   │       ├── agents/                # 10 BaseAgent subclasses + factory
│   │       │   ├── factory.ts
│   │       │   ├── intent-expander-agent.ts
│   │       │   ├── planner-agent.ts
│   │       │   ├── architect-agent.ts
│   │       │   ├── developer-agent.ts
│   │       │   ├── reviewer-agent.ts
│   │       │   ├── tester-agent.ts
│   │       │   ├── debugger-agent.ts
│   │       │   ├── quality-enforcer-agent.ts
│   │       │   ├── optimizer-agent.ts
│   │       │   └── devops-agent.ts
│   │       ├── pipeline/
│   │       │   ├── project-generator.ts     # new-project flow
│   │       │   ├── project-updater.ts       # code/design/full update flow
│   │       │   ├── project-assembler.ts     # merges artifacts → files[]
│   │       │   ├── quality-assurance.ts     # §0g final QA gate
│   │       │   └── session-manager.ts
│   │       ├── llm/                   # smart-router, anthropic-client, openai-client,
│   │       │                          #   cost-tracker, circuit-breaker
│   │       ├── routes/                # api, llm-routes, version-routes, websocket,
│   │       │                          #   export-builder, preview-*
│   │       ├── storage/               # ProjectStore, FileMemoryStore, LearningEngine
│   │       └── queue/
│   ├── web/                           # Canonical frontend — Next.js 16 :3000
│   │   ├── app/                       # App Router, layout.tsx, page.tsx, globals.css
│   │   └── components/                # AgentPipeline, PromptPanel, FileViewer,
│   │                                  #   LivePreview, LogsPanel, ProjectList,
│   │                                  #   PhaseProgress, ShowcasePanel, TemplateGallery,
│   │                                  #   KeyboardShortcuts, ToastStack, AppHeader, …
│   ├── backend/                       # Legacy backend (wraps services/*) — kept for
│   │                                  #   existing docker-compose deployments
│   └── frontend/                      # Legacy minimal frontend — kept for reference
├── packages/
│   └── agent-core/                    # Canonical agent framework
│       └── src/
│           ├── pipeline-types.ts      # AgentRole, PIPELINE_STEPS, PipelineState, events
│           ├── agent-registry.ts      # AGENT_DEFINITIONS (10 agents)
│           ├── agent-input-builder.ts # enforces "only intent_expander sees raw prompts"
│           ├── orchestrator.ts        # PipelineOrchestrator (wave-based)
│           ├── step-executor.ts       # retry + cache + timeout
│           ├── step-validator.ts      # §0f validate + deterministic auto-repair
│           ├── base-agent.ts          # abstract runtime
│           ├── agent-runner.ts / agent-chains.ts / agent-contracts.ts
│           ├── agent-memory-ops.ts / agent-metrics.ts / agent-middleware.ts
│           └── message-bus.ts
├── services/                          # Legacy service packages (used by apps/backend)
│   ├── agents/                        # Original per-agent packages
│   ├── orchestration/                 # Original orchestrator
│   ├── memory/                        # Original memory store
│   └── api-routing/                   # Original LLM router
├── core/                              # Shared primitives (config, logger, errors, types)
├── infrastructure/
│   ├── docker/                        # Dockerfile.backend, Dockerfile.frontend
│   ├── ci/ deploy.yml
│   └── scripts/ deploy.ps1, deploy.sh, backfill-generated.ps1
├── tests/unit/                        # Jest unit tests (agents / core / memory)
├── docker-compose.yml / docker-compose.dev.yml
├── turbo.json
├── package.json
├── README.md
└── ARCHITECTURE.md (this file)
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

To add a new agent (e.g. a **Research** agent as an 11th stage):

1. Add the role literal to `AgentRole` in [packages/agent-core/src/pipeline-types.ts](packages/agent-core/src/pipeline-types.ts) and append the step to `PIPELINE_STEPS`.
2. Register an `AGENT_DEFINITIONS` entry in [packages/agent-core/src/agent-registry.ts](packages/agent-core/src/agent-registry.ts) — role, model + fallbackModel, input/output schemas, systemPrompt, dependencies, retryPolicy, timeoutMs, maxConcurrency.
3. Create [apps/api/src/agents/research-agent.ts](apps/api/src/agents/) extending `BaseAgent` and implementing the `execute()` contract.
4. Register it with the agent factory in [apps/api/src/agents/factory.ts](apps/api/src/agents/factory.ts).
5. Teach the input-builder where research output should flow — add a case in [agent-input-builder.ts](packages/agent-core/src/agent-input-builder.ts) so downstream agents that depend on research receive the typed slice.
6. If the new agent emits files, update [project-assembler.ts](apps/api/src/pipeline/project-assembler.ts) merge order.
7. Add semantic validators in [step-validator.ts](packages/agent-core/src/step-validator.ts) if the output has repairable failure modes.
8. Rebuild: `npm run build` at the workspace root (turbo handles the dependency order).
9. Run typecheck + smoke test: `npm run typecheck` then `node apps/backend/test-system.cjs`.

The pipeline is explicitly designed so that adding a stage is a localised change — no event-bus plumbing, no registry registration required in the happy path.

---

## 15. Scalability considerations

### Cost control (today)

- Per-request cost tracked by `CostTracker` and surfaced via `GET /api/agents/cost`.
- Cheap models (`gpt-4o-mini`, Haiku) for devops and optimizer fallback. Sonnet for the majority of agents. Opus reserved for architect, reviewer, and quality_enforcer.
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
2. **Budget enforcement is cosmetic.** `MONTHLY_BUDGET_USD` is loaded but never checked. Add a pre-request guard in [apps/api/src/llm/smart-router.ts](apps/api/src/llm/smart-router.ts) that rejects (or downgrades to a cheaper model) when cumulative monthly cost exceeds the budget.
3. **Stuck-session recovery is manual.** A process crash leaves `status=running` projects forever. Add a startup reconciler that marks any `status=running` session older than N minutes as `failed` with `error='session_abandoned'`.
4. **Tests workspace is orphaned.** `tests/unit/` is not in `package.json` workspaces and Jest is not installed. Either wire it up (`"tests"` in `workspaces`, add Jest, run in CI) or delete it. The current ambiguity is worse than either choice.

### P1 — Output quality

5. **Reviewer does not re-review debugger fixes.** After the debugger rewrites files, there is no verification that the fixes are correct. Add a lightweight `reviewer_verify` pass (cheap model) that only re-runs if the debugger applied fixes.
6. **No syntax / typecheck gate on developer output.** The developer output validator checks path safety but not that files parse. Wire `@babel/parser` (already indirectly available via preview) or `typescript` as a compile-check; reject files that don't parse and retry the step.
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

16. **`apps/backend` + `services/*` is the legacy stack.** It predates the `apps/api` + `packages/agent-core` canonical path and is kept for backwards-compatibility with existing docker-compose deployments. New work targets `apps/api` + `packages/agent-core`.
17. **No CI runs the 26-check smoke test.** `infrastructure/ci/deploy.yml` builds and deploys but does not run `apps/backend/test-system.cjs`. Add it as a required check.
18. **Prompt templates are inline in each agent file.** Extract to [packages/agent-core/src/prompts/](packages/agent-core/src/) `<role>.md` for easier iteration and A/B experimentation.
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

