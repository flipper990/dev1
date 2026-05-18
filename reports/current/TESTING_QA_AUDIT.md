# TESTING QA AUDIT

Date: 2026-05-18

## Scope
- tests, smoke and E2E harnesses
- script wiring
- lint/typecheck/build gate truth
- pre-existing failures and reliability evidence

## What Exists
- API has substantial unit/integration/E2E harnesses.
- Web has smoke scripts (routes/rollback/a11y/visual) but limited unit/integration coverage.
- Reliability artifacts and diagnostics are extensive.

## Critical Findings
1. Root `npm run test` is a false green: most workspace test tasks are effectively non-existent in Turbo graph.
2. Root `npm run type-check` is also a false green for same reason.
3. Root `npm run lint` currently fails due API workspace eslint path/dependency mismatch.
4. Root build reported API TypeScript errors in current state.
5. Reliability reports are fragmented with conflicting outcomes across time windows.

## Evidence Highlights
- Targeted suites from subagents include passing auth/contracts/preflight checks.
- Current canary report failed due EPERM persistence timeout chain.
- Historical reports show varying Tier 1 outcomes (including 9/10 and later regressions).

## QA Maturity Decision
Current QA signal quality is not trustworthy enough for production gatekeeping.

## Must Fix Before Reliability Claims
1. Correct root task graph so test/lint/typecheck/build enforce real checks.
2. Resolve active API lint/build errors.
3. Re-run bounded canaries and regenerate one authoritative reliability report set.
4. Reduce stale artifact noise in testing directories.
