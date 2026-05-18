# Test Artifact Policy Overmatch Report

Date: 2026-05-17

## Audited Matcher
- `__tests__/**`
- `tests/**`
- `apps/**/tests/**`
- `packages/**/tests/**`
- `src/**/tests/**`
- `**/*.test.*`
- `**/*.spec.*`

## Findings
- No confirmed runtime-file overmatch bug in matcher logic after current fixes.
- Runtime source files in `tests/` paths are preserved unless they are explicitly test-named (`*.test.*` or test-dir spec policy).
- Spec-named runtime sources outside explicit test dirs are preserved.
- Deterministic contract and import-repair stages consistently ignore matched test artifact imports while remaining strict on runtime imports.

## Risks Checked
- Drops real runtime files: no (with current matcher behavior + tests).
- Drops API runtime files needed by generated apps: no evidence.
- Manifest/final mismatch introduced by matcher: no direct evidence.
- Non-test path accidental matches: no evidence.

## Regression Tests Added in Restarted Run
- Policy-level assertions for `apps/**/tests/**` and `packages/**/tests/**` runtime vs test files.
- Deterministic contract test for preserving `packages/**/tests/runtime-helper.ts` while dropping `*.spec.ts` in test dir.
- Import repair test confirming runtime files under `packages/**/tests/**` remain strict and test files are ignored.

## Conclusion
- No matcher specificity code change required in this restart.
- Additional coverage added to prevent future silent overmatch regressions.
