# Post Tier1 Second Fix Repeatability Report

## Run metadata
- Source: `apps/api/src/testing/successful-mission-results.json`
- Started: `2026-05-16T15:49:33.895Z`
- Completed: `2026-05-16T17:28:17.175Z`
- Prompt set: exact same 10 Tier 1 prompts

## Summary
- total missions: 10
- successes: 8
- failures: 2
- success percentage: 80%
- preview ready count: 8
- export ok count: 8
- unresolved import failures: 1
- QA gate failures: 0
- new failure clusters: 1 (`orchestration_failure` with project stuck `generating`)

## Per-mission results
| # | prompt (short) | missionId | projectId | status | filesCount | previewState | exportState | durationMs | retryCount | failureCategory | failurePhase | failureReason |
|---|---|---|---|---|---:|---|---|---:|---:|---|---|---|
| 1 | landing page | `pDHT4Mh3NX0wAR6u` | `LtrSQuqoWFTH` | pass | 47 | ready | ok | 308252 | 0 | - | - | - |
| 2 | SaaS dashboard | `pdiXqqXUIVHpc9kg` | `xy8F2HiuokQD` | pass | 60 | ready | ok | 1148935 | 0 | - | - | - |
| 3 | marketing site | `b1eeTg4-sXlyuKmG` | `25_Z4Csom6xO` | pass | 49 | ready | ok | 492847 | 0 | - | - | - |
| 4 | portfolio | `Pz9kQIZSf3naHpE-` | `sxK0QxBjiTsI` | pass | 51 | ready | ok | 808558 | 0 | - | - | - |
| 5 | product page | `H6vkhLkK3MGKJT_3` | `f0vOUH1vHi25` | pass | 47 | ready | ok | 466184 | 0 | - | - | - |
| 6 | admin overview | `Tfa2mte-g-sGn2aM` | `DKQtOXxNcKji` | pass | 57 | ready | ok | 484368 | 0 | - | - | - |
| 7 | docs/help center | `_tlMIUg_DK3JW8oR` | `8tRmCjgQ8oAR` | fail | 34 | null | not_attempted | 237923 | 0 | orchestration_failure | final-assembly | deterministic contract unresolved imports in `__tests__/*` files |
| 8 | pricing page | `eZIPe60X7mUcDapK` | `XY7GbsJiVItO` | pass | 49 | ready | ok | 305501 | 0 | - | - | - |
| 9 | waitlist page | `cqj1vcu5tzKmG-si` | `jLKP2m8tYOEK` | pass | 51 | ready | ok | 467988 | 0 | - | - | - |
|10| analytics dashboard | `SC24OFyWTJFZr1Wp` | `cmrOjXlXlKeo` | fail | 34 | null | not_attempted | 1202540 | 0 | orchestration_failure | slice-8/8 | project status `generating` with missing explicit error |

## Cluster notes
- Contract unresolved imports now mostly eliminated in runtime app paths; one remaining fail is test-file import cluster (`__tests__`).
- QA 96/no-blocker failures were eliminated.
- New residual reliability issue is orchestration terminal-state persistence on one mission.
