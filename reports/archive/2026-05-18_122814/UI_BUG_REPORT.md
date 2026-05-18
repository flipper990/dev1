# UI Bug Report

## Confirmed UI/System Behavior Gaps

1. Protected-route smoke mismatch (fixed)
- Severity: Medium
- Symptom: Route smoke treated auth redirects as failures.
- Root cause: script lacked authenticated cookie bootstrap.
- Status: **Fixed** in `apps/web/scripts/route-smoke.mjs`.

2. Rollback smoke marker drift (fixed)
- Severity: Low
- Symptom: rollback smoke expected old text markers.
- Root cause: stale test markers after UI copy/layout changes.
- Status: **Fixed** in `apps/web/scripts/rollback-smoke.mjs`.

3. Visual regression smoke broken (fixed)
- Severity: Medium
- Symptom: script crashed (`require is not defined in ES module scope`).
- Root cause: `.mjs` file using CommonJS import.
- Status: **Fixed** in `apps/web/scripts/visual-regression-smoke.mjs`.

4. Workspace shows active orchestration UI while mission is deadlocked
- Severity: High
- Symptom: UI appears active, but progress remains `0` at `Specification`.
- Root cause: backend generation/LLM availability issue, not pure frontend rendering.
- Status: **Open**.

5. Preview action returns deterministic failure when generation stalls
- Severity: High
- Symptom: preview start -> 502, “no files to preview.”
- Root cause: no generated files produced.
- Status: **Open** (downstream of generation failure).

## Layout/Interaction Stability Observations
- No major overlap/clipping regressions observed in audited shell flows after recent structural dock fixes.
- Modal/drawer layering and protected-route transitions functioned during test pass.
- Cannot fully certify tablet/mobile visual parity without browser automation snapshots; runtime API findings are definitive.
