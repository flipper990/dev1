# Tier 1 Remaining Failure Analysis

## Baseline under analysis (before this second fix pass)
- Source: previous 6/10 run findings from `apps/api/src/testing/successful-mission-results.json` and failed project artifacts.
- Baseline result: 10 total, 6 success, 4 failed (60%).

## Per-failed mission analysis (baseline 4 failures)
| Prompt | projectId | sessionId | failureCategory | failurePhase | exact failed imports | missing files | importer file | should target be generated | rewrite/remove/generate decision | QA score | QA blockers | QA warnings | root cause |
|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---|
| simple SaaS dashboard | `uVCu23LkZrzj` | `fvheLV7H7idOYGj-` | orchestration_failure | final-assembly | `../lib/db`, `../lib/auth` | `apps/api/src/lib/db.*`, `apps/api/src/lib/auth.*` | `apps/api/src/routes/users.ts` | yes | generate safe local stubs (imports used, no canonical rewrite candidate) | n/a | n/a | n/a | unresolved local imports, no pre-throw deterministic repair pass |
| simple portfolio | `CvsarxKyittt` | `OuJvYwYLeYlxxqHJ` | orchestration_failure | qa-gate | QA-missing imports in report + functional-e2e false fail | mixed (`AppShell`, `HeroBanner`, `PrimaryCTA`, `ContactSection`) | `src/app/layout.tsx`, `src/app/page.tsx` | mixed | policy/QA detection fix required (not pure import fix) | 96 | 0 | 10 | QA gate keyed on `qa.report.passed` + false-positive backend-route detection |
| simple admin overview | `i1A0DvxVoVfX` | `s2f6Z5BDtsNKLuAf` | orchestration_failure | final-assembly | `./UpdateItem` | `src/components/dashboard/UpdateItem.*` | `src/components/dashboard/RecentUpdatesList.tsx` | yes (if import intentional) | deterministic repair should remove if unused or create safe stub | n/a | n/a | n/a | contract rejected recoverable missing local import before repair |
| simple analytics dashboard | `V0ik2H2sGooV` | `c6vO46cJ03evy1r4` | orchestration_failure | qa-gate | none in final reason | n/a | n/a | n/a | QA pass-policy + route-detection fix | 96 | 0 | 6 | same QA policy/detection issue as portfolio |

## Why QA failed at 96/100 with blockers none
- Existing behavior used `qa.report.passed` where QA internally failed on `error` findings, not only blockers.
- `functional-e2e` emitted `error` for "Backend code detected but no HTTP routes are registered" because Next App Router handlers were not recognized in QA route detection.
- Finalization then hard-failed despite high score and no blockers.

## Cluster summary before fix
- unresolved imports / missing files: 2
- QA-gate 96 no-blocker failures: 2
