# UNKNOWN_FAILURE_ANALYSIS

## Scope and artifacts inspected
- `apps/api/src/testing/last-failure.json`
- `apps/api/src/testing/successful-mission-results.json`
- `apps/api/src/testing/last-builder-empty-failure.json`
- `apps/api/src/testing/project-state-mutations-*.jsonl` (matching project/session ids)
- Upstream failure/classification code paths in:
  - `apps/api/src/testing/successful-mission-e2e.ts`
  - `apps/api/src/testing/mission-failure-diagnostics.ts`
  - `apps/api/src/testing/generation-runner.ts`
  - `apps/api/src/pipeline/failure-diagnostics.ts`
  - `apps/api/src/pipeline/project-generator.ts`
  - `apps/api/src/llm/smart-router.ts`

## Real failed mission root cause
Primary upstream failure (before preview) is a **builder-empty generation failure**:
- `last-failure.json` records pipeline error:
  - `Builder produced 0 files in primary attempts ... AND in the reduced-prompt fallback`
  - failure phase/step persisted as qa-gate pipeline-not-completed
- `last-builder-empty-failure.json` shows why builder output became unusable:
  - response had truncation/incomplete-content signals
  - files were discarded during builder validation (`decision=discard:content-incomplete`)
  - resulting validated output was empty, triggering `Validation: builder produced no files`

So the failing generation phase is builder/slice execution, surfaced by pipeline at qa-gate finalization.

## Why "failed: unknown" appeared
Not from a single root throw; it came from fallback formatting paths that dropped details:
- Generation test formatter used `final.error ?? 'unknown'`
- Preview formatter used `previewError ?? 'unknown'`
- Smart router exhaustion used `lastError?.message ?? 'unknown'`
- Mission artifact counting swallowed errors and returned `0`, which amplified generic failed output with no clear transport/context diagnostics.

## Why `filesCount=0` appeared
Two paths existed:
1. **True zero-file generation**: builder produced/validated zero files.
2. **False zero from transport masking**: artifact listing errors were caught and coerced to `0` in mission runner (`safeArtifactsCount`), making unknown upstream failures look like zero-file generation.

## Conclusion
The concrete upstream mission blocker is builder empty output after validation discard (including fallback attempt), while the "unknown" symptom was a diagnostics quality failure caused by fallback strings and masked artifact-listing errors.
