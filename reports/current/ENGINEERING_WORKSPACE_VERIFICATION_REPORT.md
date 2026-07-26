# Engineering Workspace Verification Report

## Contract invariants

- Project files remain the authoritative source.
- Manual edits do not invoke or modify generation.
- Mutations require the expected current revision.
- Stale edits and restores return conflict responses.
- Previous and current revisions are snapshotted.
- Restore creates a new revision and retains prior history.
- Preview and verification are invalidated after source changes.
- Panel widths are clamped before persistence.

## Verification commands

- `npm run type-check --workspace=@devteam/web`
- `npm run typecheck --workspace=@devteam/api`
- `npm run test:contracts --workspace=@devteam/api`
- `npm run build --workspace=@devteam/web`
- `npm run build --workspace=@devteam/api`

## Automated coverage

The API contract map now includes file commits, checkpoint creation, checkpoint restoration, revision comparison, and revision-state reads. Existing route-contract tests verify that every exported frontend API helper maps to a registered backend route with the expected HTTP method.

## Recommended follow-up tests

- Concurrent edit conflict returns 409 and preserves the newer revision.
- Restoring vN creates vCurrent+1 and retains all earlier snapshots.
- Unsafe file paths are rejected before persistence.
- Rapid project and file switching never displays stale content.
- Panel widths restore correctly after reload and clamp on smaller screens.
- Keyboard resizing, file-tree navigation, tabs, and diff review pass browser-level accessibility tests.
