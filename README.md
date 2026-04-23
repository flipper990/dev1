# DEVteam — AI Multi-Agent Development Platform

A production-ready monorepo for generating software with a coordinated team of AI agents.

## Structure

```
devteam/
├── core/                        # Shared types, config, logger, errors, utilities
├── services/
│   ├── agents/                  # Base agent class + 11 specialized agents
│   ├── orchestration/           # 11-stage pipeline orchestrator, session manager
│   ├── memory/                  # Per-agent + global memory store
│   └── api-routing/             # Multi-model LLM router, retry + circuit breaker + cost tracker
├── apps/
│   ├── backend/                 # Fastify API server (port 3001)
│   └── web/                     # Next.js 15 dashboard (port 3000)
├── infrastructure/
│   ├── docker/                  # Dockerfiles (backend + frontend)
│   ├── scripts/                 # deploy.sh + deploy.ps1
│   └── ci/                      # GitHub Actions workflow
├── packages/
│   └── agent-core/              # Legacy pre-services agent registry
├── tests/
│   └── unit/                    # Unit tests (orphaned workspace — see ARCHITECTURE.md §13)
├── apps/backend/test-system.cjs # Live 26-check end-to-end smoke test (authoritative)
├── docker-compose.yml           # Production compose
├── docker-compose.dev.yml       # Development compose
└── .env.example                 # Environment variable template
```

## Agent Pipeline

```
prompt → intent_analyzer → planner → architect → ui_ux → coder → integration
         → reviewer → debugger → tester → optimizer → devops → output
```

11 stages, each driven by an LLM call through the API router (OpenAI / Anthropic with retry, fallback, and circuit breaker). `ui_ux`, `integration`, `debugger`, `tester`, `optimizer` are conditionally skipped based on project complexity and prior-agent signals — see `ARCHITECTURE.md` §2 for the routing rules.

Every step emits `step.started` / `step.completed` / `step.skipped` events over WebSocket for the frontend to render live.

## Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Docker (for containerized deployment)
- OpenAI or Anthropic API key

## Quick Start

```bash
# 1. Clone and install
git clone <repo>
cd devteam
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set OPENAI_API_KEY

# 3. Build all packages
npm run build

# 4. Start development servers
npm run dev
```

Frontend: http://localhost:3000  
Backend API: http://localhost:3001  
Health check: http://localhost:3001/health

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/projects` | Create project + run pipeline |
| `GET` | `/api/projects` | List projects (`?limit=&offset=`) |
| `GET` | `/api/projects/:id` | Get project by ID |
| `DELETE` | `/api/projects/:id` | Delete project |
| `GET` | `/api/agents/models` | List available LLM models |
| `POST` | `/api/agents/models/:role` | Override model for agent role |
| `GET` | `/api/agents/cost` | Cost summary by provider |
| `GET` | `/api/agents/circuit` | Circuit breaker status |
| `GET` | `/health` | Health check |
| `WS` | `/ws/session/:sessionId` | Real-time pipeline events |

### Create project example

```bash
curl -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Build a REST API for a todo app with TypeScript and PostgreSQL"}'
```

## Docker Deployment

```bash
# Production
docker compose up -d

# Development (hot-reload)
docker compose -f docker-compose.dev.yml up
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes* | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | Yes* | — | Anthropic API key |
| `PORT` | No | `3001` | Backend port |
| `STORAGE_PATH` | No | `./data` | Path for file storage |
| `JWT_SECRET` | Yes (prod) | dev value | JWT signing secret |
| `MAX_CONCURRENT_SESSIONS` | No | `5` | Concurrency limit |
| `MONTHLY_BUDGET_USD` | No | `100` | Spend limit |
| `NEXT_PUBLIC_API_BASE` | No | `http://localhost:3001` | Frontend API URL |

*At least one of OpenAI or Anthropic is required.

## Testing

```bash
# All tests
npm test --workspace=@devteam/tests

# Unit only
npm run test:unit --workspace=@devteam/tests

# With coverage
npm test --workspace=@devteam/tests -- --coverage
```

## Extending Agents

1. Add the role literal to `AgentRole` in `core/src/types.ts`
2. Add a model mapping in `core/src/config.ts` `modelsByRole`
3. Create a new class extending `BaseAgent<TInput, TOutput>` in `services/agents/src/agents/`
4. Implement `buildPrompt()` and `parseOutput()`
5. Export it from `services/agents/src/index.ts`
6. Instantiate + wire it into `services/orchestration/src/orchestrator.ts` (add to `buildInitialPipelineState`, call `runStep(...)`, merge output into `project.artifacts`)
7. Rebuild: `npm run build --workspace=@devteam/core && npm run build --workspace=@devteam/agents && npm run build --workspace=@devteam/orchestration`
8. Run `node apps/backend/test-system.cjs` to confirm no regression

```typescript
import { BaseAgent } from '../base-agent.js';

export class MyAgent extends BaseAgent<MyInput, MyOutput> {
  constructor() {
    super('my_role', 'You are an expert ...');
  }

  protected buildPrompt(input: MyInput): string {
    return `Do the thing: ${JSON.stringify(input)}`;
  }

  protected parseOutput(raw: string): MyOutput {
    return this.extractJson<MyOutput>(raw);
  }
}
```

See `ARCHITECTURE.md` §14 for a worked example.

## Architecture Decisions

- **File-based storage**: No external DB required to get started. Replace `ProjectStore` with Postgres/Redis for scale.
- **Static in-memory cache**: Step cache and request cache are process-local Maps. Replace with Redis for multi-instance deployments.
- **Sequential pipeline**: Steps run in order. BullMQ is not wired — add it to `apps/backend/src/routes/projects.ts` for background processing.
- **No auth by default**: Add a `preHandler` JWT hook in `apps/backend/src/app.ts` before production deployment.
