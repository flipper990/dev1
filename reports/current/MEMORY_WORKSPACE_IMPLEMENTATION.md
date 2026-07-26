# Memory Workspace Implementation

## Outcome

The workspace now has a first-class Memory context alongside Run and AI Thread. It exposes project, global, agent, shared, short-term, long-term, system-rule, and generation-rule sources with truthful provenance and project isolation.

## User capabilities

- Search and filter every exposed memory source.
- Filter to memories injected into the active run.
- Inspect origin, last use, derived confidence, scope, byte size, and every run that used an entry.
- Create project, agent, shared, long-term, and generation-rule memories.
- Edit, pin, unpin, and delete project-owned memories.
- Inspect immutable platform system and generation rules.
- Retain immutable historical influence snapshots after a source memory is edited or deleted.

## Provenance correction

The previous learning hook read `_lastLoadedMemories` before the current task loaded memory, which could attribute a prior task's entries. A new `onMemoriesLoaded` hook records influence immediately after retrieval/budgeting and before prompt construction/model execution. Each record includes project, run, task, agent, memory ID, source, injected snapshot, rank, relevance, effectiveness, timestamp, and injected character count.

`influence.json` is append-only from the product's perspective and retains the content snapshot necessary to audit old generations. Platform rule application is also recorded per task. Historical runs created before this implementation cannot be reconstructed and are shown without fabricated provenance.

## Security and governance

- Catalog reads require project viewer access.
- Create/edit/delete require project member access.
- Cross-project agent memories are excluded.
- Only project-owned entries are mutable.
- Platform system rules remain immutable because they contain safety and validation contracts.
- User generation rules are subordinate memory overlays; they do not replace platform rules.
- Catalog inspection is non-touching, so browsing does not alter `last used` or access counts.

## Files changed

- `packages/agent-core/src/types.ts`
- `packages/agent-core/src/base-agent.ts`
- `apps/api/src/app.ts`
- `apps/api/src/storage/memory-store.ts`
- `apps/api/src/storage/memory-store.management.test.ts`
- `apps/api/src/routes/api.ts`
- `apps/api/src/routes/api-contract.test.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/workspace/page.tsx`
- `apps/web/src/features/workspace/components/MemoryWorkspace.tsx`
- `apps/web/src/features/workspace/components/index.ts`

## Investigation agents

- memory_storage mapped the actual file-backed stores and CRUD gaps.
- memory_generation traced prompt injection and found stale attribution.
- memory_ui designed placement within the existing editor-centered architecture.
- memory_contracts defined authorization, isolation, and API requirements.
- memory_rules separated immutable governed rules from editable overlays.
- memory_tests identified persistence and provenance regression coverage.

All agents investigated read-only. The lead agent produced the single merged implementation.

## Verification

- API typecheck: passed.
- Web typecheck: passed.
- Focused memory persistence/provenance tests: 2 passed.
- Full API regression suite: 23 passed.
- API contract suite: passed.
- Web route smoke tests: 8 passed.
- Web accessibility smoke tests: 5 passed.
- API production build: passed.
- Web production build: passed; 39 static pages generated.

## Remaining hardening

Short-term memory remains intentionally process-local with a two-hour TTL. For horizontally scaled or restart-resilient deployments, move the influence ledger and ephemeral memory to the configured database with workspace-level retention controls.
