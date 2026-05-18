# ZERO_FILE_GENERATION_REPORT

## Zero-file taxonomy now enforced
The system now classifies zero-file failures using explicit categories:
- `provider_empty_output`
- `builder_empty_output`
- `manifest_parse_failure`
- `contract_rejected_all_files`
- `artifact_assembly_failure`
- `generation_timeout`
- `provider_error`
- `orchestration_abort`
- `fallback_failed`

## Implemented handling changes
1. Mission diagnostics now read structured trace and failure fields first, and only classify zero-file when zero files are **confirmed**.
2. Artifact listing failures are no longer silently converted to `filesCount=0` in mission E2E.
   - listing failure now returns `count=-1`, `verified=false`, plus listing error text.
3. When listing fails, mission result uses `artifact_assembly_failure` fallback (instead of pretending zero-file generation).
4. `filesGeneratedBeforeFailure` now avoids negative values and preserves structured values from persisted failure trace when present.

## Root-cause classification for inspected failed generation
For the inspected upstream failure (`last-failure.json` + `last-builder-empty-failure.json`):
- classification: `builder_empty_output`
- phase: builder slice execution surfaced at qa-gate pipeline completion check
- fallback generation: attempted and also empty
