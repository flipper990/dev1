# Engineering Workspace Implementation

## Outcome

The Code workbench is now the primary workspace surface. Preview, Logs, and Diagnostics remain available as secondary workspace modes.

## Implemented capabilities

### Source navigation

- Searchable file explorer backed by `GET /api/projects/:id/files`.
- Hierarchical source tree derived from authoritative file paths.
- Expandable folders and accessible file selection.
- Multiple open-file tabs with active and dirty indicators.

### Editing and review

- Editable source buffer backed by the selected project file.
- Side-by-side split diff appears for unsaved edits.
- Accept changes commits the file through the API as a new project revision.
- Reject changes restores the last authoritative file content without making a server mutation.
- Save conflicts use the expected project version and return HTTP 409 rather than overwriting newer work.
- Editing is rejected while generation is running.

### Revisions and checkpoints

- Every accepted edit snapshots the previous revision and persists the new revision.
- Manual checkpoints create immutable project revisions without changing source.
- Restore creates a new revision from a selected checkpoint; history is never destructively rewound.
- Revision comparison loads authoritative snapshots and returns per-file before/after content with change statistics.
- Restores and edits mark verification as pending because source has changed.

### Layout

- Code is the default workspace mode.
- File explorer, editor, and diff viewer form the central engineering surface.
- Explorer and diff widths are pointer- and keyboard-resizable.
- Panel sizes are scoped per project and persisted in local storage.
- On smaller screens, the source tree and editor remain usable without introducing a second global navigation system.

## Backend additions

- `PUT /api/projects/:id/files/*` — commit one file with optimistic version checking.
- `POST /api/projects/:id/checkpoints` — create a durable checkpoint revision.
- `POST /api/projects/:id/versions/:version/restore` — restore a checkpoint as a new revision.
- `GET /api/projects/:id/versions/compare?from=&to=` — compare two authoritative revisions.

All mutation routes enforce project membership through existing authorization guards. Generation code and generation routes were not modified.

## Primary files

- `apps/web/src/features/workspace/components/CodeWorkbench.tsx`
- `apps/web/app/workspace/page.tsx`
- `apps/web/src/features/workspace/components/WorkspaceTabs.tsx`
- `apps/web/lib/api.ts`
- `apps/api/src/routes/version-routes.ts`
- `apps/api/src/routes/api-contract.test.ts`

## Constraints

- The editor uses a native monospaced editing surface because Monaco, CodeMirror, and resizable-panel dependencies are not installed.
- Diff rendering is line-aligned and intentionally bounded to existing project snapshots; it does not claim semantic AST diffing.
- Accept and Reject apply to the current editor buffer. Generated changes remain committed by the existing generation pipeline and are not retroactively staged.
