# PREVIEW_TIMEOUT_DIAGNOSTICS_REPORT

Date: 2026-05-19

## Timeout diagnostics coverage
Timeout diagnostics now persist explicit source/limit/phase/progress/log/process-state fields across:

- preview persistence (`project.preview`)
- timeout dump (`apps/api/src/testing/last-preview-timeout.json`)
- local failure dump (`apps/api/src/testing/last-local-preview-failure.json`)
- runtime failure dump (`apps/api/src/testing/last-preview-runtime-failure.json`)
- project diagnostics artifact (`diagnostics.previewValidationArtifacts`)
- canary results (`successful-mission-results.json`)

## Captured timeout details
- Timeout source: `preview-manager:boot-watchdog`
- Timeout limit: manager boot timeout budget in ms
- Current phase: snapshot of `previewStep`
- Elapsed: computed elapsed wall-clock at capture
- Last log line: extracted from stderr/stdout tails
- Process state: lifecycle classification (`crashed`, `alive-hanging`, etc.)

## Result in this rerun
The 3-prompt rerun did not produce a preview timeout. One mission failed due generated TypeScript build error during preview build; failure phase/reason and process state were captured.
