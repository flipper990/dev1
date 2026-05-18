# POST_UNKNOWN_FAILURE_FIX_TIER1_RESULT

## Tier 1 rerun command (single mission)
```powershell
$env:PROMPTS_JSON='["Build a simple startup landing page with hero and CTA."]'
$env:REPEAT_CYCLES='1'
$env:MIN_SUCCESS_MISSIONS='0'
npm run test:missions:e2e --workspace=@devteam/api
```

## Measured result (run completed)
- success/failure: **success**
- projectId: `n48Ypq4BAyl3`
- sessionId: `IAG-91N3if-t0zKN`
- filesCount: `48`
- failureCategory: `null` (not failed)
- failurePhase: `null` (not failed)
- previewState: `ready`
- exportState: `ok`

## Summary
- succeeded=1
- failed=0
- successRate=1.0

Source artifact: `apps/api/src/testing/successful-mission-results.json`
