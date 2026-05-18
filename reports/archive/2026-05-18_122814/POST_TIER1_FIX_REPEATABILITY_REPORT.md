# Post Tier 1 Fix Repeatability Report

## Run metadata
- Source: `apps/api/src/testing/successful-mission-results.json`
- Started: 2026-05-16T14:00:33.045Z
- Completed: 2026-05-16T15:35:10.522Z
- Prompts: exact same 10 Tier 1 prompts from baseline pass

## Aggregate result
- Total missions: 10
- Successful missions: 6
- Failed missions: 4
- Success percentage: 60%
- Average runtime (successful): 436,981 ms
- Average files generated (all): 47.1
- Preview success rate: 60%
- Export success rate: 60%

## Per-mission results
| # | Prompt (short) | Mission ID | Project ID | Final status | Files | Preview | Export | Runtime ms | Retry count | Failure category | Failure phase | Failure reason |
|---|---|---|---|---|---:|---|---|---:|---:|---|---|---|
| 1 | landing page | `G-RMm9GSwa7tQ0zL` | `s7RJMS90i40U` | pass | 48 | ready | ok | 524516 | 0 | - | - | - |
| 2 | SaaS dashboard | `fvheLV7H7idOYGj-` | `uVCu23LkZrzj` | fail | 33 | null | not_attempted | 1200595 | 0 | orchestration_failure | reported `slice-7/7` (project failure shows final-assembly) | project status=generating with missing explicit error (project failure persisted as deterministic contract fail) |
| 3 | marketing site | `gY9yUzK5ym8k_jMU` | `0MEEwHhmDkts` | pass | 48 | ready | ok | 540786 | 0 | - | - | - |
| 4 | portfolio | `OuJvYwYLeYlxxqHJ` | `CvsarxKyittt` | fail | 51 | null | not_attempted | 680717 | 0 | orchestration_failure | qa-gate | QA gate failed: score 96/100 (blockers=none) |
| 5 | product page | `eAdmwcc6QPdXqYcm` | `x2Qidb3oh8wn` | pass | 47 | ready | ok | 295960 | 0 | - | - | - |
| 6 | admin overview | `s2f6Z5BDtsNKLuAf` | `i1A0DvxVoVfX` | fail | 42 | null | not_attempted | 675047 | 0 | orchestration_failure | final-assembly | deterministic contract: `src/components/dashboard/RecentUpdatesList.tsx -> ./UpdateItem` |
| 7 | docs/help center | `dCj2eLe0dymrf5S2` | `OUMb8dTK2cIi` | pass | 52 | ready | ok | 519168 | 0 | - | - | - |
| 8 | pricing page | `9NmDIPd_qw73JV3_` | `fhayfhXQB5au` | pass | 48 | ready | ok | 375991 | 0 | - | - | - |
| 9 | waitlist page | `Lxp_LoLIcYlBzjxj` | `f6t60ByJOi5X` | pass | 50 | ready | ok | 365464 | 0 | - | - | - |
|10| analytics dashboard | `c6vO46cJ03evy1r4` | `V0ik2H2sGooV` | fail | 52 | null | not_attempted | 499081 | 0 | orchestration_failure | qa-gate | QA gate failed: score 96/100 (blockers=none) |

## Contract/preview/export diagnostics
- Provider failures: 0
- Preview failures: 0 (all successful missions reached preview ready)
- Export failures: 0 (all successful missions exported OK)
- Builder-empty failures: 0
- Unknown failures: 0

