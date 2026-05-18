# Tier1 Failure Cluster Delta

## Delta (6/10 run -> second-fix run)
- baseline: 6 success / 4 fail (60%)
- current: 8 success / 2 fail (80%)
- net: +20 percentage points

## Cluster comparison
| failure cluster | baseline count | current count | delta |
|---|---:|---:|---:|
| unresolved imports / contract rejection | 2 | 1 | -1 |
| QA gate score 96 / blockers none | 2 | 0 | -2 |
| builder-empty | 0 | 0 | 0 |
| unknown | 0 | 0 | 0 |
| new orchestration terminal-state issue | 0 | 1 | +1 |

## Interpretation
- Targeted clusters were reduced as intended.
- QA policy + route-detection fix removed QA false-fail cluster entirely.
- Import-repair pass reduced unresolved-import failures, but one test-artifact import cluster remains.
- A non-targeted orchestration lifecycle issue appeared once and now becomes next highest-priority reliability risk.
