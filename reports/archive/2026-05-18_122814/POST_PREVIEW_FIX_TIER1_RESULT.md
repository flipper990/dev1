# POST_PREVIEW_FIX_TIER1_RESULT

## Run Configuration
- API URL: `http://127.0.0.1:3013`
- Prompt set: exactly one Tier-1 mission
  - `Build a simple startup landing page with hero and CTA.`
- `MIN_SUCCESS_MISSIONS=1`
- No Tier-2/Tier-3 prompts executed

## Command
`npm run test:missions:e2e:raw --workspace=@devteam/api`
(with `PROMPTS_JSON` containing one Tier-1 prompt)

## Result
- FAILED (`succeeded=0`, `required=1`)
- Summary from `apps/api/src/testing/successful-mission-results.json`:
  - `total=1`
  - `tier1 succeeded=0`
  - failure reason: `mission ended with status=failed: unknown`
  - `filesCount=0`
  - `previewState=null`

## Interpretation
This specific rerun did not reach preview startup; it failed upstream in mission generation/orchestration. Therefore preview-startup success could not be measured on this single mission execution.
