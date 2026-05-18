# Root Cause Failure Analysis

## Scope and Evidence Window
- Source of truth: `data/projects/*/project.json` (latest 30 failed projects), plus `apps/api/src/testing/last-*.json` artifacts.
- Time window analyzed: 2026-05-12 through 2026-05-14.

## Failed Run Evidence (Representative, Real)

1. `FLTYKkYoqp3j`
- Phase: `final-integrity-gate`
- Category: `artifact_corruption` / internal import drift
- Diagnostic: `Final integrity gate FAILED — 1 dangling internal import(s): app/404/page.tsx ? '@/components/NotFoundPage'`
- Missing/invalid files: `components/NotFoundPage.tsx` missing while imported.
- Generated output causing failure: `app/404/page.tsx` imports missing symbol.
- Root cause type: invalid file tree + missing imports.

2. `WgGaD-wbsQ5-`
- Phase: `slice-1/1`
- Category: artifact integrity
- Diagnostic: `EMPTY_SOURCE_FILE: Generated source file is empty: components/HeroBanner.tsx`
- Missing/invalid files: empty `components/HeroBanner.tsx`
- Generated output causing failure: 0-byte source file at merge gate.
- Root cause type: empty generation / invalid generated code artifact.

3. `y3MqRrocaFpN`
- Phase: `qa-gate`
- Category: policy/gate mismatch
- Diagnostic: `QA gate failed: score 96/100 (blockers=none)`
- Missing/invalid files: none mandatory missing; gate failed despite no blockers.
- Generated output causing failure: large mixed tree (`app/*` + `src/app/*` + infra) produced non-convergent QA score behavior.
- Root cause type: bad prompt decomposition + invalid file tree drift + gate contract mismatch.

4. `wC8gSDOs3AcL`
- Phase: preview startup
- Category: preview install/runtime failure
- Diagnostic: local preview install failed (`npm install` cache permission error), plus generated project includes placeholder pages and UI stubs.
- Missing/invalid files: quality-invalid source stubs (`src/components/ui/*.tsx` trivial wrappers), placeholder `src/app/page.tsx`.
- Generated output causing failure: non-production placeholders and weak component bodies.
- Root cause type: invalid generated code + preview install fragility.

5. `last-builder-empty-failure.json` (`v7okRkaLts1uqsFX`)
- Phase: `components` builder attempt 3
- Category: model output format/content drift
- Diagnostic: `Validation: builder produced no files`
- Parsing details: raw response had files, but critical file discarded for `content-incomplete:unbalanced JSX tags` and whole response marked discard.
- Generated output causing failure: truncated/incomplete `src/components/ui/Button.tsx` payload.
- Root cause type: model output format drift + invalid generated code.

6. `last-preview-timeout.json` (`jc3prZP2KZ9O`)
- Phase: preview build
- Category: timeout
- Diagnostic: `Preview startup timed out after 150s [cause=build-hung]` at `preview:building`.
- Missing/invalid files: no single missing file; build path failed to converge within budget.
- Root cause type: timeout + unstable generated build surface.

## What Is Actually Failing
- Failures are not primarily from missing retries/instrumentation.
- Failures are dominated by non-deterministic generation of infrastructure-critical files and unstable artifact shapes.
- Current safeguards catch many failures late; they do not sufficiently prevent invalid artifacts from being generated.
