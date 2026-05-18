# PRIORITY FIX ROADMAP

Date: 2026-05-18

## P0 (Must fix before more testing)
1. Fix preview proxy auth leakage: strip auth/cookie/CSRF headers before forwarding to generated app.
2. Fix project persistence EPERM path for mission creation (`data/projects` mkdir/tmp write race/permission behavior).
3. Repair root task graph so `test` and `type-check` run real workspace tasks.
4. Restore API lint/build health (eslint wiring + current TS compile failures).
5. Establish one authoritative reliability report output to avoid stale/conflicting decisions.

## P1 (Should fix before Tier 2)
1. Add explicit degraded-success terminal status when fallback/stub paths are used.
2. Tune/validate preview watchdog timeout budgets against cold fullstack boot reality.
3. Improve preview/export metric correctness (count success on completed stream only).
4. Unify migration source-of-truth (inline vs SQL) and schedule auth token cleanup lifecycle.
5. Split `apps/api/src/testing` source code from runtime artifacts.

## P2 (Cleanup/refactor)
1. Decompose monolithic modules (`project-generator.ts`, `preview-manager.ts`, `generation-runner.ts`).
2. Enforce package boundaries (`@devteam/agent-core` exports; stop deep relative imports into package internals).
3. Standardize web component root structure (`components` vs `src/components`).
4. Archive and prune report/artifact sprawl under defined retention policy.

## P3 (Polish/future)
1. Remove placeholder/dead UI flows or clearly gate them as non-production labs.
2. Harmonize navigation semantics and branding labels across shells.
3. Expand web unit/integration test coverage beyond smoke scripts.
4. Replace temporary preview install workarounds with deterministic dependency policy.

## Top 10 Fixes (Cross-cut)
1. Preview proxy header sanitization.
2. EPERM persistence root-cause and durable fix.
3. Root test/type-check task wiring repair.
4. API lint green.
5. API TS build green.
6. Canary rerun (1/3/5) with fresh authoritative report.
7. Degraded-success status model.
8. Preview timeout budget calibration.
9. Artifact storage separation + retention cleanup phase 1.
10. Package boundary hardening for agent-core imports.
