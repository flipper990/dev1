# Tier 1 Failure Deep Dive

## Baseline analyzed run (pre-fix)
- Source: `apps/api/src/testing/tier1-repeatability-data.json`
- Total: 10
- Success: 3
- Failed: 7
- Success rate: 30%

## Failed mission breakdown (baseline 7/10 fails)
| Prompt | Project ID | Session ID | Failure category | Failure phase | Exact reason | Files accepted before fail | Files rejected | Builder output empty | Fallback triggered | Fallback failed | Final filesCount | Root cause |
|---|---|---|---|---|---|---:|---:|---|---|---|---:|---|
| simple SaaS dashboard | `1J-JhsBGjqSk` | `00tTrwdtD9xiEZXK` | orchestration_failure | final-assembly | dangling import in `src/app/logout/page.test.tsx -> ./page` | 36 | 1 | no | no | n/a | 36 | Contract checked generated test artifact and hard-failed |
| simple marketing website | `Soj8JTjgMe25` | `GxSkeMoYmDA2fcy-` | empty_generation | qa-gate | builder produced 0 files in primary and reduced fallback | 51 | 0 | yes | yes | yes | 51 | Builder-empty path had no deterministic terminal recovery |
| simple portfolio | `njfwxAWw5YPw` | `tjZfi-ogxfm0AYdG` | empty_generation | qa-gate | builder produced 0 files in primary and reduced fallback | 53 | 0 | yes | yes | yes | 53 | Same systemic builder-empty failure mode |
| simple admin overview | `IVxGokIB-J-5` | `cTxxcKrzp-sP4cWN` | orchestration_failure | final-assembly | dangling imports in `src/app/api/users/route.test.ts` | 47 | 2 | no | no | n/a | 47 | Contract enforced imports for generated `.test.ts` artifact |
| simple docs/help center | `BBFpwKZtyWHb` | `AjpdbLi7t_5JCoQL` | orchestration_failure | qa-gate | QA gate failed 95/100 (no blockers) | 56 | 0 | no | no | n/a | 56 | QA threshold/score behavior (not builder-empty/contract) |
| simple waitlist | `lHGph30_xe5Z` | `awZJAsHaCLsPKzJg` | orchestration_failure | final-assembly | dangling imports from `app/page.tsx` to missing `../components/*` | 49 | 5 | no | no | n/a | 49 | Mixed `app/` + `src/app/` canonicalization issue |
| simple analytics dashboard | `junlM8QtIiUH` | `nI9bP-y1iaSlE5zW` | orchestration_failure | final-assembly | dangling import in `src/app/api/metrics.kpis/route.test.ts -> ./route` | 53 | 1 | no | no | n/a | 53 | Contract enforced imports for generated test artifact |

## Root causes confirmed
1. Contract rejection cluster (4): deterministic import-integrity was hard-failing generated test artifacts and mixed root-vs-src path cases.
2. Builder-empty cluster (2): reduced fallback still ended in zero files with no deterministic final recovery.
3. Other (1): QA gate fail with no blockers (not addressed in this fix scope).

