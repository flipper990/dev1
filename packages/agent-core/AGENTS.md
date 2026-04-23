# Multi-Agent System — Complete Design Reference

> **LEGACY DOCUMENT.** This file describes the original 8-agent design from the pre-`services/` layout (`packages/agent-core` registry). The production pipeline has since moved to `services/agents` and now runs **11 stages**. For the authoritative, up-to-date system description see [`ARCHITECTURE.md`](../../ARCHITECTURE.md) at the repo root.
>
> Current 11-stage pipeline:
> `intent_analyzer → planner → architect → ui_ux → coder → integration → reviewer → debugger → tester → optimizer → devops`
>
> Changes from the version documented below:
> - `developer` was renamed to `coder` and moved to `services/agents/src/agents/coder-agent.ts`
> - Three new agents added: `intent_analyzer`, `ui_ux`, `integration`
> - Coder now receives a full design system (palette, typography, radii, motion) from `ui_ux` before writing any UI code
> - `services/api-routing` replaces the per-agent model routing fields shown below; routing is configured in `core/src/config.ts` `modelsByRole`
> - Memory entries are stored by `services/memory` (file-based); `pgvector` backend is planned but not wired
>
> The sections below are kept for historical context on the original design intent.

---

## Agent Roster (8 Agents)

```
┌──────────┐     ┌───────────┐     ┌───────────┐ ┌────────┐
│ Planner  │────▶│ Architect │────▶│ Developer │ │ DevOps │
└──────────┘     └───────────┘     └─────┬─────┘ └────────┘
                                         │          (parallel)
                                   ┌─────▼─────┐
                                   │ Reviewer   │  Tester │
                                   └─────┬──────┘─────────┘
                                         │          (parallel)
                                   ┌─────▼─────┐
                                   │ Debugger  │
                                   └─────┬─────┘
                                   ┌─────▼─────┐
                                   │ Optimizer │
                                   └───────────┘
```

---

## Per-Agent Specification

### 1. Planner

| Field | Value |
|---|---|
| **Role** | Decomposes user prompts into an execution plan with tasks, priorities, and dependencies |
| **Input** | `{ prompts: string[], userPreferences?: object }` |
| **Output** | `{ projectName, summary, tasks[], constraints[], stackHints }` |
| **Model** | Claude Opus (primary) → GPT-4o (fallback) |
| **Memory** | Full (short-term + long-term). Recalls successful planning patterns and user preferences |
| **Timeout** | 30s |
| **File** | `packages/agent-core/src/prompts.ts` → `PROMPTS.planner` |

### 2. Architect

| Field | Value |
|---|---|
| **Role** | Converts plan into technical spec: file tree, schema, API contracts, component hierarchy |
| **Input** | `{ plan: PlannerOutput, userPreferences?: object }` |
| **Output** | `{ techStack, fileTree[], dbSchema, apiContracts[], components[], envVars[] }` |
| **Model** | Claude Opus (primary) → GPT-4o (fallback) |
| **Memory** | Full. Recalls architecture patterns for similar project types |
| **Timeout** | 45s |
| **File** | `packages/agent-core/src/prompts.ts` → `PROMPTS.architect` |

### 3. Developer

| Field | Value |
|---|---|
| **Role** | Generates production-quality source code from the technical spec |
| **Input** | `{ spec: ArchitectOutput, fileAssignment: string[], context?: GeneratedFiles }` |
| **Output** | `{ files: { path, content, language }[] }` |
| **Model** | Claude Sonnet (primary) → GPT-4o (fallback) |
| **Memory** | Full. Recalls code patterns, avoids patterns that caused bugs |
| **Concurrency** | 4 instances (parallel file generation) |
| **Timeout** | 60s |
| **File** | `packages/agent-core/src/prompts.ts` → `PROMPTS.developer` |

### 4. Reviewer

| Field | Value |
|---|---|
| **Role** | Reviews generated code for correctness, security (OWASP Top 10), consistency |
| **Input** | `{ spec: ArchitectOutput, files: GeneratedFile[] }` |
| **Output** | `{ issues[], score: 0-100, passable: boolean, summary }` |
| **Model** | Claude Opus (primary) → GPT-4o (fallback) |
| **Memory** | Full. Recalls common bug patterns, flags recurring issues at higher severity |
| **Timeout** | 60s |
| **File** | `packages/agent-core/src/prompts.ts` → `PROMPTS.reviewer` |

### 5. Tester

| Field | Value |
|---|---|
| **Role** | Generates unit, integration, and component test suites |
| **Input** | `{ files: GeneratedFile[], apiContracts: APIContract[], spec: ArchitectOutput }` |
| **Output** | `{ testFiles: { path, content, testType }[], coverage: CoverageMap }` |
| **Model** | Claude Sonnet (primary) → GPT-4o-mini (fallback) |
| **Memory** | Light. Prioritizes testing areas that historically had bugs |
| **Concurrency** | 2 instances |
| **Timeout** | 45s |
| **File** | `packages/agent-core/src/prompts.ts` → `PROMPTS.tester` |

### 6. Debugger

| Field | Value |
|---|---|
| **Role** | Fixes issues from Reviewer/Tester with targeted patches |
| **Input** | `{ issues: Issue[], affectedFiles: GeneratedFile[], spec?: ArchitectOutput }` |
| **Output** | `{ patches: { file, oldContent, newContent, explanation }[], unresolved[] }` |
| **Model** | Claude Sonnet (primary) → GPT-4o (fallback) |
| **Memory** | Full. Recalls bug-fix patterns, saves new ones |
| **Concurrency** | 2 instances |
| **Timeout** | 30s |
| **File** | `packages/agent-core/src/prompts.ts` → `PROMPTS.debugger` |

### 7. DevOps

| Field | Value |
|---|---|
| **Role** | Generates Dockerfiles, docker-compose, CI/CD, env templates, README |
| **Input** | `{ spec: ArchitectOutput, fileTree: string[] }` |
| **Output** | `{ files: { path, content }[] }` |
| **Model** | GPT-4o-mini (primary) → Claude Haiku (fallback) |
| **Memory** | Light. Recalls successful Docker/CI configurations |
| **Timeout** | 20s |
| **File** | `packages/agent-core/src/prompts.ts` → `PROMPTS.devops` |

### 8. Optimizer

| Field | Value |
|---|---|
| **Role** | Final-pass performance optimization: queries, caching, bundle size, lazy loading |
| **Input** | `{ files: GeneratedFile[], spec: ArchitectOutput, qaReport?: ReviewOutput }` |
| **Output** | `{ patches[], recommendations[], perfEstimate }` |
| **Model** | Claude Sonnet (primary) → GPT-4o-mini (fallback) |
| **Memory** | Light. Recalls optimizations that worked vs caused regressions |
| **Timeout** | 30s |
| **File** | `packages/agent-core/src/prompts.ts` → `PROMPTS.optimizer` |

---

## Agent Communication

### Pattern: Hub-and-Spoke via Message Bus

Agents **never communicate directly**. All messages flow through the orchestrator via a Redis Streams message bus.

```
Agent A ──publish──▶ Redis Stream ──consume──▶ Orchestrator ──publish──▶ Agent B
```

### Message Types

| Type | Direction | Purpose |
|---|---|---|
| `task_assign` | Orchestrator → Agent | Assign work with input data |
| `task_result` | Agent → Orchestrator | Return completed output |
| `task_error` | Agent → Orchestrator | Report failure with error details |
| `status` | Agent → Orchestrator | Progress update (streaming) |
| `signal` | Orchestrator → Agent | Cancel, pause, or reconfigure |

### Implementation

- **Production**: `RedisMessageBus` using Redis Streams + consumer groups for at-least-once delivery
- **Testing**: `InMemoryMessageBus` with synchronous dispatch
- Each agent role has its own stream: `agent:{role}:inbox`
- Messages are ACK'd only after successful processing (automatic retry on failure)

**Source**: `packages/agent-core/src/message-bus.ts`

---

## Task Orchestration

### Execution DAG (Topological Sort)

```
Stage 0: [planner]                    — sequential
Stage 1: [architect]                  — depends on planner
Stage 2: [developer, devops]          — parallel, depend on architect
Stage 3: [reviewer, tester]           — parallel, depend on developer
Stage 4: [debugger]                   — depends on reviewer (optional stage)
Stage 5: [optimizer]                  — depends on debugger (optional stage)
```

### Orchestration Rules

1. **Within a stage**: all agents execute in parallel
2. **Between stages**: strict ordering (stage N+1 waits for stage N)
3. **Input assembly**: orchestrator collects outputs from upstream agents and routes them as inputs to downstream agents
4. **Optional stages**: stages 4–5 can fail without aborting the pipeline
5. **Critical path**: if planner, architect, or developer fails → pipeline aborts

### Implementation

The `PipelineOrchestrator` class:
1. Topologically sorts agents by their `dependencies` field
2. Executes each stage with `Promise.allSettled()` (parallel)
3. Collects artifacts in `sessionArtifacts` map
4. Routes artifacts to downstream agents via `buildAgentInput()`
5. Emits typed events for real-time progress tracking

**Source**: `packages/agent-core/src/orchestrator.ts`

---

## Failure Handling

### Error Classification

| Error Code | Retryable | Cause |
|---|---|---|
| `RATE_LIMITED` | Yes | Provider rate limit (429) |
| `TIMEOUT` | Yes | LLM call exceeded timeout |
| `PROVIDER_ERROR` | Yes | Provider internal error (500) |
| `PARSE_ERROR` | Yes | LLM output couldn't be parsed as JSON |
| `VALIDATION_ERROR` | Yes | Parsed output failed schema validation |
| `TOKEN_OVERFLOW` | No | Input too large for model context window |
| `AUTH_ERROR` | No | Invalid API key or permissions |
| `UNKNOWN` | No | Unclassified error |

### Circuit Breaker (per LLM provider)

```
CLOSED ──(5 failures)──▶ OPEN ──(60s)──▶ HALF-OPEN ──(2 successes)──▶ CLOSED
                            ▲                  │
                            └──(any failure)────┘
```

- When a provider's circuit is **open**, the router skips it and goes directly to the fallback
- **Half-open** allows 2 test requests; if both succeed, the circuit closes
- Prevents cascading failures when a provider is down

**Source**: `packages/agent-core/src/resilience.ts`

---

## Retry Strategy

### Per-Agent Retry Policies

| Agent | Max Attempts | Base Delay | Max Delay | Backoff |
|---|---|---|---|---|
| Planner | 3 | 2s | 15s | 2× |
| Architect | 3 | 2s | 15s | 2× |
| Developer | 3 | 1.5s | 10s | 2× |
| Reviewer | 2 | 3s | 15s | 2× |
| Tester | 2 | 2s | 10s | 2× |
| Debugger | 2 | 1s | 8s | 2× |
| DevOps | 3 | 1s | 8s | 2× |
| Optimizer | 2 | 2s | 10s | 2× |

### Retry Flow

```
Attempt 1 → fail (retryable)
  ├── delay: baseDelay × backoff^0 ± 25% jitter = ~2s
  ▼
Attempt 2 → fail (retryable)
  ├── delay: baseDelay × backoff^1 ± 25% jitter = ~4s
  ▼
Attempt 3 → fail
  └── Mark task as FAILED, check if fallback model available
        ├── Yes → retry sequence with fallback model
        └── No  → report failure to orchestrator
```

### Key Design Decisions

- **Jitter**: ±25% randomization on each delay prevents thundering herd when multiple agents hit the same provider
- **Non-retryable errors**: `TOKEN_OVERFLOW` and `AUTH_ERROR` fail immediately (no retry will fix them)
- **Fallback escalation**: primary model retries exhaust first, then the entire retry sequence runs again on the fallback model
- **Timeout racing**: each agent call races against a deadline (`Promise.race`); timeouts are retryable

**Source**: `packages/agent-core/src/resilience.ts` → `executeWithRetry()`

---

## Memory System

### Two-Tier Architecture

| Tier | Backend | Scope | TTL | Purpose |
|---|---|---|---|---|
| **Short-Term** | Redis (list) | Per-session, per-agent | Session duration | Current task context, intermediate outputs |
| **Long-Term** | PostgreSQL + pgvector | Per-agent, global | Permanent (with decay) | Learned patterns, bug fixes, preferences |

### Short-Term Memory Flow
1. Before agent execution: load last N entries from `stm:{sessionId}:{agentRole}`
2. Entries are injected into the prompt as context
3. After execution: push new entry with task input/output summary
4. List is trimmed to max 50 entries per agent per session

### Long-Term Memory Flow
1. Before execution: embed the task description → cosine similarity search in `agent_memory`
2. Top-5 most relevant memories injected into prompt
3. After execution: agent's `extractLearnings()` method identifies patterns worth saving
4. Embeddings are generated and stored; near-duplicates (>0.92 similarity) merge instead of duplicating

### Memory Decay
- Daily cron: all `relevance_score` values multiplied by 0.95
- Each access boosts score by +0.2 (capped at 2.0)
- Entries below 0.1 score and not accessed for 90 days are archived

**Source**: `packages/agent-core/src/memory.ts`

---

## Scalability to 20+ Agents

### How to Add a New Agent

1. **Add the role** to `AgentRole` union type in `types.ts`
2. **Add the prompt** to `PROMPTS` in `prompts.ts`
3. **Add the definition** to `AGENT_DEFINITIONS` in `agent-registry.ts` (set dependencies, model, memory config)
4. **Implement the agent** by extending `BaseAgent` (4 abstract methods)
5. **Register** the agent instance in the orchestrator's agent map

The topological sort in `getExecutionOrder()` automatically resolves the new agent into the correct execution stage based on its `dependencies`.

### Designed-In Scalability

| Concern | Mechanism |
|---|---|
| **Adding agents** | Plugin-style: add to registry, set dependencies, system auto-sorts |
| **Parallel execution** | `maxConcurrency` per agent; multiple instances in one stage |
| **Independent scaling** | Agents are stateless; scale worker count per role via BullMQ |
| **Memory isolation** | Each agent has its own long-term memory partition; no cross-contamination |
| **Bus throughput** | Redis Streams scale with consumer groups; add readers per stream |
| **Failure isolation** | Per-agent timeouts + circuit breakers; one agent's failure doesn't block unrelated agents |

---

## File Structure

```
packages/agent-core/src/
├── types.ts           # All type definitions (AgentRole, Task, Session, etc.)
├── base-agent.ts      # Abstract BaseAgent class all agents extend
├── agent-registry.ts  # 8 agent definitions + model routing + topological sort
├── prompts.ts         # Production prompt templates for all 8 agents
├── orchestrator.ts    # PipelineOrchestrator + default pipeline definition
├── message-bus.ts     # Redis Streams bus + in-memory test implementation
├── memory.ts          # MemoryManager (Redis + pgvector) + in-memory test impl
├── resilience.ts      # CircuitBreaker + retry engine + ResilientModelRouter
└── index.ts           # Barrel exports
```
