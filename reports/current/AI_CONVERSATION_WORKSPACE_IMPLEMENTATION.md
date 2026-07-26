# AI Conversation Workspace Implementation

## Outcome

The workspace project-context rail is now a professional work thread. The engineering editor remains the central surface while requests, agent activity, revisions, and results occupy a dedicated contextual workspace.

## Thread model

Each retained prompt is rendered as a chronological request with an expandable execution receipt. The receipt displays:

- Prompt and timestamp
- Agent actions for the current retained pipeline ledger
- A factual reasoning summary based on revision output
- Changed files
- Generated revision artifacts
- Verification status
- Preview health snapshot
- Runtime
- Cost
- Model/provider when retained by the pipeline ledger

Historical evidence that was not persisted is explicitly labelled “Not retained.” The interface does not fabricate assistant messages or private chain-of-thought.

## Supported actions

- **Continue conversation** submits a follow-up through the existing project update route.
- **Retry prompt** resubmits the exact retained prompt through the existing update flow.
- **Branch conversation** creates a real independent project from the selected revision snapshot.
- **Restore previous prompt** restores that revision’s files as a new project revision.
- **Copy prompt** copies exact prompt text.
- **Pin prompt** persists per-project pins on the current device.
- **Search conversation** filters prompt text and changed file paths.
- **Collapse tool activity** hides or reveals the execution receipt for each request.

## Backend addition

`POST /api/projects/:id/versions/:version/branch` creates a new project from an authoritative snapshot. It does not mutate the source project or alter generation behavior. The branch receives its own project ID, revision history, output tree, and snapshot.

## Data integrity

- Numeric revisions remain the durable prompt-to-files boundary.
- Restore and branch are blocked while generation is running.
- Branch snapshots reset preview, validation, task, and pipeline evidence so the new project does not inherit misleading runtime state.
- Current model and agent actions come from retained pipeline ledger records.
- Historical model, verification, and preview evidence are marked unavailable when not persisted.

## Main files

- `apps/web/src/features/workspace/components/ConversationWorkspace.tsx`
- `apps/web/app/workspace/page.tsx`
- `apps/web/src/features/workspace/components/WorkspaceMainPanel.tsx`
- `apps/api/src/routes/version-routes.ts`
- `apps/web/lib/api.ts`
- `apps/api/src/routes/api-contract.test.ts`
