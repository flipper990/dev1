# DEVteam — Multi-Agent AI Development Platform Architecture

## 1. Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                │
│  Next.js App (React) — Prompt UI, Live Preview, Code Editor, Export │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ WebSocket + REST
┌──────────────────────────────▼──────────────────────────────────────┐
│                        API GATEWAY (Fastify)                        │
│  Auth (JWT/OAuth) │ Rate Limiting │ Request Validation │ Billing    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    ORCHESTRATION LAYER                              │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐   │
│  │  Session     │  │  Pipeline    │  │  Agent Communication Bus  │  │
│  │  Manager     │  │  Controller  │  │  (Redis Streams)          │  │
│  └─────────────┘  └──────────────┘  └───────────────────────────┘   │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐   │
│  │  API Router  │  │  Memory      │  │  Artifact Store           │  │
│  │  (Model Sel) │  │  Manager     │  │  (Code + Assets)          │  │
│  └─────────────┘  └──────────────┘  └───────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                        AGENT LAYER                                  │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Architect│ │ Frontend │ │ Backend  │ │ QA Agent │ │ DevOps   │   │
│  │ Agent    │ │ Agent    │ │ Agent    │ │          │ │ Agent    │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     INFRASTRUCTURE LAYER                            │
│                                                                     │
│  PostgreSQL │ Redis │ S3/MinIO │ BullMQ │ Docker (Sandboxed Exec)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Component | Responsibility |
|---|---|
| **Client** | Prompt input, real-time build progress, code preview, download/export |
| **API Gateway** | Auth, validation, rate limiting, WebSocket upgrade, billing hooks |
| **Orchestration** | Pipeline sequencing, agent dispatch, artifact aggregation |
| **Agent Layer** | Specialized code generation, review, and infrastructure tasks |
| **Infrastructure** | Persistence, queuing, file storage, sandboxed execution |

---

## 2. Agent System Design

### Agent Roster

| Agent | Role | Input | Output |
|---|---|---|---|
| **Architect** | Decomposes user prompt into a technical spec: stack, schema, file tree, API contracts | User prompts (1–3) | `project_spec.json` — file tree, schema, API routes, component list |
| **Frontend** | Generates UI code (React/Next.js/Vue/Svelte) from spec | `project_spec.json` + component list | `/frontend/**` source files |
| **Backend** | Generates server code (Node/Python/Go) from spec | `project_spec.json` + API contracts + schema | `/backend/**` source files |
| **QA** | Reviews all generated code for bugs, security, consistency | Full codebase artifact | Fix patches + test files + `qa_report.json` |
| **DevOps** | Generates Dockerfile, docker-compose, CI config, env templates | `project_spec.json` + codebase | Infra files: `Dockerfile`, `.env.example`, `docker-compose.yml` |

### Agent Contract (TypeScript Interface)

```typescript
interface AgentMessage {
  sessionId: string;
  agentId: AgentRole;
  type: 'task' | 'result' | 'error' | 'status';
  payload: {
    artifact?: CodeArtifact;   // files produced
    spec?: ProjectSpec;        // structured spec
    patches?: Patch[];         // code fixes from QA
    status?: string;           // progress update
  };
  metadata: {
    model: string;             // which LLM was used
    tokens: { input: number; output: number };
    latencyMs: number;
  };
}

type AgentRole = 'architect' | 'frontend' | 'backend' | 'qa' | 'devops';
```

### Communication Pattern

Agents do **not** talk to each other directly. All communication flows through the **Agent Communication Bus** (Redis Streams):

```
User Prompt
    │
    ▼
Architect ──produces──▶ project_spec.json
    │                        │
    │          ┌─────────────┼─────────────┐
    │          ▼             ▼             ▼
    │     Frontend       Backend       DevOps
    │     Agent          Agent         Agent
    │          │             │             │
    │          ▼             ▼             ▼
    │     /frontend/**   /backend/**   Infra files
    │          │             │             │
    │          └─────────────┼─────────────┘
    │                        ▼
    │                    QA Agent
    │                        │
    │                        ▼
    │               Patches + Report
    │                        │
    │          ┌─────────────┤ (if fixes needed)
    │          ▼             ▼
    │     Frontend       Backend
    │     (patch)        (patch)
    │          │             │
    │          └──────┬──────┘
    │                 ▼
    └──────▶  Final Artifact Bundle
```

**Key design decisions:**
- Pipeline Controller enforces ordering; agents are stateless workers.
- Each agent call is idempotent — retry-safe on failure.
- QA can trigger a single re-generation cycle (max 1 retry to avoid infinite loops).

---

## 3. API Routing System

### Overview

The LLM routing system is built around a **pluggable provider registry** and a **task-aware smart router** that automatically selects the best model for each agent/task combination, handles retry with exponential backoff, falls back through a model chain, tracks costs per request, and supports dynamic model switching at runtime.

```
┌─────────────────────────────────────────────────────────────┐
│                     SmartLLMRouter                          │
│            (implements LLMClient interface)                  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Task-Based   │  │ Model        │  │  Cost Tracker    │  │
│  │ Routing      │  │ Overrides    │  │  (per-request)   │  │
│  │ Rules Engine │  │ (dynamic)    │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│  ┌──────▼─────────────────▼──────────────────────────────┐  │
│  │        Retry + Fallback Chain Engine                   │  │
│  │   Primary → Fallback 1 → Fallback 2 → Error           │  │
│  │   (exponential backoff w/ jitter per model)            │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────▼────────────────────────────────┐  │
│  │        Circuit Breaker (per provider)                  │  │
│  │   closed ↔ open → half-open → closed                   │  │
│  └──────────────────────┬────────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  Provider Registry                           │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ Anthropic    │ │ OpenAI       │ │ (future: Google,     │ │
│  │ Client       │ │ Client       │ │  Local, etc.)        │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Task Category Routing

Each agent role maps to a **task category**, which determines the default model selection:

| Task Category | Primary Model | Fallback Chain | Agents |
|---|---|---|---|
| **Planning** | Claude Opus | GPT-4o → Sonnet | planner |
| **Reasoning** | Claude Opus | GPT-4o → Sonnet | architect, debugger |
| **Code Generation** | GPT-4o | Sonnet → GPT-4o-mini | developer |
| **Code Review** | Claude Opus | GPT-4o | reviewer, optimizer |
| **Testing** | Claude Sonnet | GPT-4o-mini | tester |
| **Infrastructure** | GPT-4o-mini | Sonnet | devops |

### Model Override Resolution (Priority Order)

```
1. Runtime role override (POST /api/llm/overrides)
2. Runtime category override
3. Model hint from agent definition
4. Routing rule for task category
5. Default model (Claude Sonnet)
```

### Provider Abstraction

Every provider implements `LLMProviderClient`:

```typescript
interface LLMProviderClient {
  readonly providerId: LLMProvider;       // 'anthropic' | 'openai' | 'google' | 'local'
  readonly displayName: string;
  chatSync(params: LLMRequestParams): Promise<LLMResponse>;
  chatStream(params: LLMRequestParams): AsyncGenerator<string>;
  healthCheck?(): Promise<boolean>;       // optional liveness probe
}
```

Adding a new provider (e.g., Google Gemini) requires:
1. Create a class implementing `LLMProviderClient`
2. Register it: `registry.register(new GoogleClient(apiKey, logger))`
3. Add routing rules for the desired task categories

### Retry & Fallback

- **Per-model retry**: Up to 3 attempts with exponential backoff + jitter
- **Fallback chain**: Each routing rule specifies an ordered list of fallbacks
- **Circuit breaker**: Per-provider, opens after 5 consecutive failures, recovers after 60s
- **Error classification**: `RATE_LIMITED`, `TIMEOUT`, `PROVIDER_ERROR`, `NETWORK_ERROR` are retryable; `AUTH_ERROR`, `TOKEN_OVERFLOW` are not

### Cost Tracking

Every LLM call is recorded with:
- Provider, model, token counts (in/out)
- Estimated cost (USD, from built-in pricing table)
- Latency, agent role, task category
- Whether a fallback was used, success/failure

Available via REST API:
- `GET /api/llm/costs` — aggregate cost summary
- `GET /api/llm/costs/records` — individual records (filterable)
- `GET /api/llm/circuit-breaker` — provider health states
- `GET /api/llm/providers` — registered providers
- `POST /api/llm/overrides` — dynamic model switching

### Key Files

| File | Purpose |
|---|---|
| `apps/api/src/llm/types.ts` | Shared types, task categories, routing rules |
| `apps/api/src/llm/smart-router.ts` | SmartLLMRouter — main routing engine |
| `apps/api/src/llm/provider-registry.ts` | Provider registration & health checks |
| `apps/api/src/llm/cost-tracker.ts` | Per-request cost estimation & aggregation |
| `apps/api/src/llm/anthropic-client.ts` | Anthropic Claude provider |
| `apps/api/src/llm/openai-client.ts` | OpenAI provider |
| `apps/api/src/llm/router.ts` | Factory function, backward-compatible alias |

---

## 4. Memory System

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      MEMORY LAYER                          │
│                                                            │
│  ┌──────────────────┐  ┌─────────────────────────────────┐ │
│  │  Per-Agent Memory │  │     Global Shared Memory        │ │
│  │  (per-role JSON)  │  │  (cross-agent, global.json)     │ │
│  └────────┬─────────┘  └──────────────┬──────────────────┘ │
│           │                            │                    │
│  ┌────────▼────────────────────────────▼──────────────────┐ │
│  │               MemoryStore Interface                    │ │
│  │  getShortTerm / setShortTerm / queryLongTerm           │ │
│  │  saveLongTerm / query / getGlobal / saveGlobal         │ │
│  │  recordOutcome / embed                                 │ │
│  └────────┬──────────────────────────────────┬────────────┘ │
│           │                                  │              │
│  ┌────────▼──────────┐          ┌────────────▼───────────┐ │
│  │  FileMemoryStore   │          │  MemoryManager         │ │
│  │  (dev: JSON files) │          │  (prod: Redis+pgvector)│ │
│  └───────────────────┘          └────────────────────────┘ │
│                                                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  LearningEngine                        │ │
│  │  Observes task outcomes → Updates memory effectiveness │ │
│  │  Detects failure patterns → Promotes best practices    │ │
│  │  Tracks prompt effectiveness → Consolidates memories   │ │
│  └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Memory Types

| Type | Description | Stored by | Auto-promoted to global? |
|---|---|---|---|
| `context` | Current task context, intermediate reasoning | All agents | No |
| `pattern` | Successful patterns (stacks, code styles, architectures) | All agents | Yes (effectiveness ≥ 80%) |
| `failure` | Repeated error patterns detected by LearningEngine | LearningEngine | Yes |
| `error_fix` | Specific bug fixes and their solutions | reviewer, debugger | Yes (effectiveness ≥ 80%) |
| `decision` | Architectural/design decisions and constraints | planner, architect | Yes (effectiveness ≥ 80%) |
| `preference` | User style and naming preferences | Pipeline | No |
| `prompt` | Effective prompt strategies with success rates | LearningEngine | No |
| `global` | Cross-agent knowledge promoted from high-performers | Auto-promotion | N/A (already global) |

### Memory Tags

Entries are tagged for retrieval filtering:
`tech-stack`, `architecture`, `code-style`, `performance`, `security`, `testing`, `deployment`, `api-design`, `database`, `ui-ux`, `error-handling`, `best-practice`, `anti-pattern`, `prompt-engineering`

### MemoryEntry Schema

```typescript
interface MemoryEntry {
  id: string;
  agentRole: AgentRole | 'global';
  type: MemoryType;
  content: string;
  relevanceScore: number;      // 0–2.0, decays 5%/cycle, boosted on access
  tags: MemoryTag[];
  successCount: number;        // times this memory led to success
  failureCount: number;        // times this memory led to failure
  effectiveness: number;       // successCount / (successCount + failureCount)
  embedding?: number[];        // vector embedding (pgvector prod only)
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
}
```

### Memory Query System

```typescript
interface MemoryQuery {
  roles?: AgentRole[];         // filter by agent role
  types?: MemoryType[];        // filter by memory type
  tags?: MemoryTag[];          // ALL tags must match
  minRelevance?: number;       // minimum relevance score
  minEffectiveness?: number;   // minimum success rate
  limit?: number;              // max results (default 10)
  queryText?: string;          // keyword search (dev) or vector search (prod)
  includeGlobal?: boolean;     // also search global shared memory
}
```

### Memory Retrieval Flow (3-Phase)

Before each agent invocation:
1. **Short-term**: Load session-scoped memories for the current task (latest 5).
2. **Long-term**: Query agent-specific persistent memories by relevance + effectiveness rank (top 5).
3. **Global**: Query cross-agent shared memory for high-effectiveness patterns, error fixes, and decisions (top 3, min effectiveness 50%, min relevance 0.3).

All three phases' results are merged, deduped, and injected into the agent's prompt.

### Learning Engine

The `LearningEngine` (in `apps/api/src/storage/learning-engine.ts`) observes the full agent lifecycle:

| Phase | Trigger | Action |
|---|---|---|
| **Task Start** | Agent begins execution | Records which memories were loaded (observation) |
| **Task Success** | Agent completes successfully | `recordOutcome(id, true)` on all used memories; checks for promotion to global |
| **Task Failure** | Agent fails | `recordOutcome(id, false)` on all used memories; accumulates failure pattern |
| **Failure Pattern** | Same error 3× from one agent | Creates `failure` memory + promotes to global with `error-handling` tag |
| **Promotion** | Memory reaches 80%+ effectiveness with 3+ uses | Copies to global memory with `best-practice` tag and `originAgent` metadata |
| **Prompt Tracking** | After pipeline completes | Saves effective prompt strategies (70%+ success) as `prompt` type memories |
| **Consolidation** | Periodic (e.g., daily) | Merges similar memories, prunes low-effectiveness entries (<20% with 5+ samples) |

### Ranking Algorithm

Composite score for memory retrieval ordering:

```
score = relevanceScore
      + effectiveness × 0.5          (boost proven patterns)
      + max(0, 0.3 × (1 - ageDays/30))  (recency boost, 30-day decay)
      + 0.1 × log₂(1 + accessCount)     (frequency boost, logarithmic)
```

### Memory Decay
- `relevanceScore` decays by 0.95× per cycle.
- Each access boosts score by +0.1 for success, -0.05 for failure.
- High-effectiveness (>80%) entries are preserved even at low relevance.
- Entries below 0.05 relevance are archived if not accessed in 30 days.

### Storage Backends

| Backend | Short-Term | Long-Term | Search | When to Use |
|---|---|---|---|---|
| `FileMemoryStore` | In-memory Map | JSON files per role | Keyword (Jaccard) | Dev / staging |
| `InMemoryMemoryStore` | In-memory Map | In-memory array | Score sort | Unit tests |
| `MemoryManager` | Redis lists | PostgreSQL + pgvector | Cosine similarity | Production |

Migration path: All three implement `MemoryStore` interface — swap in `app.ts` with zero code changes elsewhere.

---

## 5. Project Generation Pipeline

### Overview

The pipeline transforms a user prompt into a full working project (frontend + backend + DevOps) through 7 sequential agent steps with state tracking, step-by-step execution, and automatic error recovery.

### The 7 Steps

```
INPUT: 1–3 user prompts (10–5000 chars each)

STEP 1 — PLANNING  [Planner Agent, critical]
├── Analyze user prompts
├── Define project scope, tasks, constraints
├── Suggest tech stack
└── Output: projectName, summary, tasks[], constraints[], stackHints

STEP 2 — ARCHITECTURE  [Architect Agent, critical]
├── Design full system architecture from plan
├── Define file tree, DB schema, API contracts, components
└── Output: techStack, fileTree[], dbSchema, apiContracts[], components[], envVars[]

STEP 3 — DEVELOPMENT  [Developer Agent, critical]
├── Generate all source code files from spec
├── Frontend components, backend routes, models, config
└── Output: files[] { path, content, language }

STEP 4 — CODE REVIEW  [Reviewer Agent, non-critical]
├── Review all generated code for quality issues
├── Check imports, security, error handling, consistency
└── Output: issues[], patches[] (optional fixes)

STEP 5 — TESTING  [Tester Agent, non-critical]
├── Generate test suites for the codebase
├── Unit tests, integration tests, API tests
└── Output: testFiles[] { path, content }

STEP 6 — BUG FIXING  [Debugger Agent, non-critical]
├── Fix issues identified by reviewer
├── Apply targeted patches to affected files
└── Output: patches[] { file, oldContent, newContent }

STEP 7 — DEVOPS  [DevOps Agent, non-critical]
├── Generate deployment configuration
├── Dockerfile, docker-compose, CI/CD, .env.example
└── Output: files[] { path, content }

OUTPUT: Full project (files[], plan, spec, qaReport, task summaries, cost tracking)
```

### State Tracking

Every pipeline execution maintains a `PipelineState` object:

```typescript
interface PipelineState {
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  steps: StepState[];         // per-step status, attempts, timing
  artifacts: Map<AgentRole, Record<string, unknown>>;
  tasks: Task[];
  progress: number;           // 0–1 fraction
  error?: string;
}
```

Each step tracks: `status` (pending/running/completed/failed/skipped), `attempt` count, `durationMs`, and any `error`.

### Error Recovery

1. **Automatic retry** — Each agent has a configurable `RetryPolicy` with exponential backoff + jitter (e.g., Planner: 3 attempts, 2s base delay, 2x multiplier, max 15s)
2. **Dependency checking** — Before each step, the orchestrator verifies upstream artifacts exist. Missing deps → skip non-critical or abort critical steps
3. **Critical vs non-critical** — Steps 1–3 (Plan/Architect/Develop) are critical; failure aborts the pipeline. Steps 4–7 (Review/Test/Fix/DevOps) are non-critical; failure is logged and skipped
4. **Cancellation** — The orchestrator supports `cancel()` to stop after the current step
5. **Timeout** — Each agent has a per-definition timeout (30s–120s)

### Project Assembly

After all steps complete, the `ProjectGenerator` assembles the final output:

1. Collect developer source files into a file map (dedup by path)
2. Merge DevOps config files (Dockerfile, CI/CD, etc.)
3. Merge tester-generated test files
4. Apply debugger patches (string replacement in affected files)
5. Apply reviewer patches (if any)
6. Build task summaries with cost/token/duration per agent
7. Save `ProjectRecord` with all files written to disk

### Production Deployment Artifacts

To guarantee deployable output even when agent output is partial, assembly enforces a production baseline:

1. Ensure `.env.example` exists and includes required variables from architect `envVars`
2. Ensure `.dockerignore` is present with sane defaults
3. Ensure `Dockerfile` exists (multi-stage baseline)
4. Ensure `docker-compose.yml` exists with health checks
5. Ensure deployment scripts exist:
  - `scripts/deploy.sh`
  - `scripts/deploy.ps1`
  - `scripts/validate-env.sh`
  - `scripts/validate-env.ps1`
6. Ensure `.github/workflows/deploy.yml` exists for image build/publish
7. Scaffold optional provider templates when missing:
  - `vercel.json`
  - `infra/aws/cloudformation.yaml`

This makes generated projects production-ready by default while still allowing the DevOps agent to provide richer, stack-specific deployment configs.

### Real-Time Progress

Progress is streamed via WebSocket at `/ws/sessions/:id/progress`:

```json
{
  "type": "progress",
  "data": {
    "sessionId": "abc123",
    "status": "active",
    "progress": 0.43,
    "currentStep": {
      "stepId": "code",
      "name": "Development",
      "agent": "developer",
      "description": "Writing source code for all components"
    },
    "steps": [
      { "stepId": "plan",   "status": "completed", "durationMs": 8200 },
      { "stepId": "design", "status": "completed", "durationMs": 12400 },
      { "stepId": "code",   "status": "running",   "durationMs": 0 },
      { "stepId": "review", "status": "pending",   "durationMs": 0 },
      { "stepId": "test",   "status": "pending",   "durationMs": 0 },
      { "stepId": "fix",    "status": "pending",   "durationMs": 0 },
      { "stepId": "deploy", "status": "pending",   "durationMs": 0 }
    ]
  }
}
```

### Key Files

| File | Purpose |
|---|---|
| `packages/agent-core/src/orchestrator.ts` | Pipeline state machine, step executor, retry, input assembly |
| `apps/api/src/pipeline/project-generator.ts` | End-to-end flow: validate → execute → assemble → save |
| `apps/api/src/pipeline/session-manager.ts` | Session + step-level progress tracking, subscriber pattern |
| `apps/api/src/routes/api.ts` | REST endpoints including `POST /api/projects/generate` |
| `apps/api/src/routes/websocket.ts` | WebSocket progress streaming |

---

## 6. Tech Stack Recommendations

### Platform Stack

| Layer | Technology | Justification |
|---|---|---|
| **Frontend** | Next.js 15 (App Router) + Tailwind + shadcn/ui | SSR for landing, CSR for app, great DX |
| **Backend API** | Node.js + Fastify | Fastest Node framework, schema-based validation, WebSocket native |
| **Orchestration** | BullMQ (Redis-backed) | Reliable job queuing, retries, priority, concurrency control |
| **Agent Bus** | Redis Streams | Lightweight pub/sub with persistence, consumer groups |
| **Primary DB** | PostgreSQL 16 + pgvector | Relational + vector search in one DB |
| **Cache/Session** | Redis 7 | Session state, agent working memory, rate limiting |
| **Object Storage** | S3 (prod) / MinIO (dev) | Generated project zip storage |
| **Sandbox Execution** | Docker-in-Docker or Firecracker | Isolated code validation (syntax, lint, test runs) |
| **Auth** | Better Auth or Lucia | Self-hosted, no vendor lock-in |
| **Payments** | Stripe | Usage-based billing |
| **Observability** | OpenTelemetry → Grafana stack | Traces per agent call, cost tracking, latency dashboards |
| **Deployment** | Docker Compose (small) / Kubernetes (scale) | Progressive complexity |

### Agent Implementation Stack

```
agents/
├── base-agent.ts          # Abstract agent with memory injection, streaming, error handling
├── architect-agent.ts     # Spec generation
├── frontend-agent.ts      # UI code generation
├── backend-agent.ts       # Server code generation
├── qa-agent.ts            # Review and patching
├── devops-agent.ts        # Infrastructure files
└── utils/
    ├── prompt-builder.ts  # Constructs system + user prompts with memory context
    ├── artifact-parser.ts # Extracts code files from LLM output
    └── token-counter.ts   # Pre-flight token estimation
```

---

## 7. Scalability Considerations

### Scaling Axes

| Dimension | Strategy |
|---|---|
| **Concurrent users** | Stateless API servers behind load balancer; session state in Redis |
| **Agent throughput** | BullMQ workers scale horizontally; each worker processes one agent task |
| **LLM API limits** | Per-provider rate limiting with token bucket; queue overflow to fallback provider |
| **Storage** | S3 with lifecycle policies (archive after 30 days, delete after 90) |
| **Database** | Read replicas for memory queries; connection pooling via PgBouncer |
| **WebSocket** | Sticky sessions via load balancer; or use Redis pub/sub for cross-node fan-out |

### Capacity Planning

```
Single Server (8 vCPU, 32GB RAM):
├── ~20 concurrent generation sessions
├── ~3 parallel LLM API calls per session (frontend + backend + devops)
├── ~60 active LLM calls to providers
└── Bottleneck: LLM API rate limits, not compute

Horizontal (3 API nodes + 5 worker nodes):
├── ~100 concurrent sessions
├── ~300 active LLM calls
└── Requires provider enterprise tier or multi-key rotation
```

### Queue Priority System

```typescript
enum JobPriority {
  CRITICAL = 1,   // Patch application (user waiting)
  HIGH = 2,       // Code generation (user waiting)
  NORMAL = 3,     // QA review
  LOW = 4,        // Memory extraction, analytics
  BACKGROUND = 5, // Memory decay, cleanup
}
```

---

## 8. Cost Optimization Strategy

### Per-Generation Cost Estimate

| Agent | Model | ~Input Tokens | ~Output Tokens | ~Cost |
|---|---|---|---|---|
| Architect | Claude Opus | 3,000 | 4,000 | $0.135 |
| Frontend | Claude Sonnet | 6,000 | 12,000 | $0.072 |
| Backend | Claude Sonnet | 6,000 | 12,000 | $0.072 |
| QA | Claude Opus | 20,000 | 3,000 | $0.345 |
| DevOps | GPT-4o-mini | 2,000 | 2,000 | $0.002 |
| Patches (avg) | Claude Haiku | 4,000 | 2,000 | $0.005 |
| **Total** | | | | **~$0.63** |

### Optimization Levers

| Strategy | Savings | Implementation |
|---|---|---|
| **Prompt caching** | 30–50% on input tokens | Anthropic prompt caching for system prompts (stable across calls) |
| **Model tiering** | 40–60% vs all-Opus | Use cheaper models for templated/simple tasks (see routing table) |
| **Output schema enforcement** | 10–20% fewer output tokens | Structured output modes reduce verbose explanations |
| **Spec-based chunking** | Avoid re-generating | Only regenerate files that QA flagged, not entire codebase |
| **Memory-assisted generation** | 15–25% fewer tokens | Inject learned patterns instead of re-deriving from scratch |
| **Batch API (off-peak)** | 50% cost reduction | Non-urgent tasks (memory extraction, analytics) use batch endpoints |
| **Token budget per session** | Hard cap risk control | Abort generation if cumulative tokens exceed 200K per session |

### Pricing Model Recommendation

| Tier | Price | Includes |
|---|---|---|
| Free | $0 | 2 generations/month, basic stacks only |
| Pro | $29/mo | 50 generations/month, all stacks, priority queue |
| Team | $99/mo | 200 generations/month, shared memory, team preferences |
| Enterprise | Custom | Unlimited, self-hosted option, SLA |

Estimated gross margin at Pro tier: ~$0.63 × 50 = $31.50 cost → break-even. Profit comes from users who don't use full allocation + memory efficiency gains reducing per-gen cost over time.

---

## 9. Project Directory Structure

```
devteam/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── app/
│   │   │   ├── (auth)/         # Login, signup
│   │   │   ├── (dashboard)/    # Project list, new project
│   │   │   ├── (generator)/    # Prompt input, live progress, preview
│   │   │   └── api/            # Next.js API routes (BFF)
│   │   └── components/
│   └── api/                    # Fastify backend
│       ├── src/
│       │   ├── routes/         # REST + WebSocket endpoints
│       │   ├── agents/         # Agent implementations
│       │   ├── orchestration/  # Pipeline controller, session manager
│       │   ├── memory/         # Memory manager, vector search
│       │   ├── llm/            # API router, provider clients, streaming
│       │   ├── storage/        # S3/MinIO artifact storage
│       │   └── db/             # Drizzle ORM schemas, migrations
│       └── workers/            # BullMQ worker processes
├── packages/
│   ├── shared/                 # Types, constants, validation schemas
│   ├── agent-core/             # Base agent class, prompt builder, artifact parser
│   └── config/                 # ESLint, TypeScript, Tailwind shared configs
├── docker/
│   ├── Dockerfile.api
│   ├── Dockerfile.web
│   ├── Dockerfile.worker
│   └── docker-compose.yml
├── infra/                      # Terraform/Pulumi (optional)
├── turbo.json                  # Turborepo config
├── pnpm-workspace.yaml
└── .env.example
```

---

## 10. Security Considerations

| Concern | Mitigation |
|---|---|
| **Prompt injection via user input** | Sanitize inputs; separate system/user prompt boundaries; validate spec JSON schema before passing to downstream agents |
| **Generated code security** | QA Agent specifically checks OWASP Top 10; sandboxed execution prevents malicious code from affecting platform |
| **API key exposure** | Keys in env vars only; never logged; rotated via secrets manager |
| **Sandbox escape** | Docker with `--no-new-privileges`, read-only root fs, network disabled, resource limits (CPU/mem/time) |
| **Data isolation** | Row-level security in PostgreSQL; tenant ID on all queries; S3 bucket policies per user |
| **Rate limiting** | Per-user, per-IP, per-session limits at gateway level |
| **Code export safety** | Scan generated archives for known malware signatures before delivery |

---

## 11. Key Design Principles

1. **Agents are stateless** — all state lives in Redis/Postgres. Any worker can pick up any agent task.
2. **Pipeline is resumable** — crash at any step → restart from last checkpoint.
3. **No vendor lock-in for users** — generated code has zero platform dependencies. Standard frameworks, standard deployment.
4. **No vendor lock-in for platform** — LLM provider abstraction layer means swapping models is a config change.
5. **Memory compounds value** — the more the platform is used, the better generations get. This is the moat.
6. **Stream everything** — users see progress in real-time. Never make them stare at a spinner for 60s.
7. **Fail fast, retry smart** — circuit breakers on LLM providers, idempotent agent calls, max 1 QA retry loop.
