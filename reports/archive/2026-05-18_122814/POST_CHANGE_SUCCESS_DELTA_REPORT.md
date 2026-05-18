# POST_CHANGE_SUCCESS_DELTA_REPORT

## Baseline vs Current
- Previous measured success rate: **1/6 (16.7%)**
- New measured success rate (post runtime/bootstrap changes): **0/7 (0.0%)**

## New Run Summary
- Total missions: **7**
- Successful missions: **0**
- Failed missions: **7**
- Success percentage: **0.0%**
- Mission window: **2026-05-15T01:30:09.776Z -> 2026-05-15T01:54:36.591Z**
- API used for measured run: **http://127.0.0.1:3303**

## Success Rate by Tier
- Tier 1: **0/2 (0.0%)**
- Tier 2: **0/2 (0.0%)**
- Tier 3: **0/3 (0.0%)**

## Delta
- Absolute change vs baseline: **-16.7 percentage points**
- Relative direction: **regression**

## Failure Pattern in This Run
All 7 failures were classified as `dependency_failure`, with terminal reason pattern:
- `INVALID_PACKAGE_JSON: package.json failed validation (strict-react-next-bundle-pins)`

## Truthful Decision
Runtime startup/DB bootstrapping improvements were validated, and missions now execute end-to-end. Mission success-rate improvement was **not** achieved in this measured run.
