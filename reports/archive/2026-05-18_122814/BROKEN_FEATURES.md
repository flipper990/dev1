# Broken Features

## Critical

1. End-to-end AI generation completion
- Status: **BROKEN**
- Observed: sessions remain `active` at `Specification` with progress `0` for extended periods.
- Impact: no usable generated files, no runtime preview, no export completion path.

2. LLM provider operational health
- Status: **BROKEN**
- Observed: `/api/llm/providers/health` -> `{ openai: false }`.
- Impact: orchestration cannot complete real agent work.

## High

3. Mission deadlock handling
- Status: **BROKEN**
- Observed: stuck active generations remain listed in runtime debug with no timeout/fail-fast transition.
- Impact: misleading “active” state, user trust degradation, resource leakage.

4. Preview viability for stalled missions
- Status: **BROKEN (downstream)**
- Observed: preview start returns `502` “no files to preview.”
- Impact: workspace cannot validate runtime output.

## Medium

5. QA smoke script reliability (resolved in this audit)
- Route smoke auth handling mismatch (fixed)
- Rollback marker drift (fixed)
- Visual smoke ESM import bug (fixed)

## Not Broken (intentional placeholders)
- Billing management
- Deployments backend
- Settings persistence
- Demo/waitlist submission backends
