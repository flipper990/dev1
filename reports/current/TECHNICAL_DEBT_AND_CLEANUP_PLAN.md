# TECHNICAL DEBT AND CLEANUP PLAN

Date: 2026-05-18
Scope: planning only. No cleanup executed.

## Debt Overview
Major debt clusters:
1. Artifact volume explosion in `reports/` and API test-run outputs.
2. Runtime artifacts mixed inside source directories (`apps/api/src/testing`).
3. Stale/legacy/temp directories and files (`.legacy`, `.scratch`, `.tmp-*`).
4. Large modules with mixed concerns (`project-generator.ts`, `preview-manager.ts`, `generation-runner.ts`).
5. Workaround code paths still active in preview runtime.

## Files/Areas Too Large or Doing Too Much
- `apps/api/src/pipeline/project-generator.ts`
- `apps/api/src/preview/preview-manager.ts`
- `apps/api/src/testing/generation-runner.ts`

## Repeated or Messy Patterns
- Repeated run-artifact dumps (`project-state-mutations-*.jsonl`, `last-*.json`) in source path.
- Reliability markdown proliferation with overlapping claims.
- Mixed component roots in web app.

## Cleanup Categories

### SAFE TO ARCHIVE
- `reports/current/*` snapshots once superseded.
- historical reliability/audit markdown from root moved into dated archive sets.
- old runtime result files from testing harnesses.

### SAFE TO DELETE AFTER BACKUP
- stale temp files at repo root (`.tmp-*`, `ts-error.log`).
- failed preview runtime folders and stale test-run artifacts not needed for active debugging.
- duplicate generated artifacts where newer canonical copy exists.

### DO NOT DELETE
- source files under `apps/*/src`, `packages/*/src`.
- tests (`*.test.ts`, smoke scripts) and migration files.
- package manifests, lockfiles, tsconfig, turbo config.
- env examples and real product docs currently in use.

### NEEDS HUMAN REVIEW
- `.scratch/` contents (contains tracked DB/runtime internals).
- `reports/archive/` retention policy due possible forensic/compliance value.
- `.legacy` files in web pending owner confirmation.
- any artifact also referenced by current incident postmortems.

## Proposed Cleanup Phases (Future Work)
1. Define retention policy and canonical report source of truth.
2. Separate testing source from testing artifacts (`src/testing` vs `data/testing-artifacts`).
3. Sweep high-confidence temp artifacts.
4. Refactor oversized modules and remove temporary fallback code after tests cover safe removal.

## Keep vs Remove Guidance
Keep:
- diagnostics architecture, but store artifacts outside source tree.
- preview/generation instrumentation capability.

Remove/Archive:
- stale generated reports and obsolete temp dumps.
- duplicate historical markdown in root once archived.
