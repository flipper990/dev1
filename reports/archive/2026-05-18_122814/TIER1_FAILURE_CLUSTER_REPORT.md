# TIER1_FAILURE_CLUSTER_REPORT

- total failed missions: 7

## Cluster Counts
- provider failure: 0
- builder-empty: 2
- contract rejection: 4
- preview failure: 0
- export failure: 0
- timeout: 0
- unknown: 0
- other: 1

## Cluster Details
### builder-empty
- classification: systemic
- missionId=GxSkeMoYmDA2fcy-, projectId=Soj8JTjgMe25, phase=qa-gate, step=qa-gate:pipeline-not-completed, reason=Pipeline did not reach 'completed' state (state=failed, error=Critical step "Build" failed: Builder produced 0 files in primary attempts (VALIDATION_ERROR: Validation: builder produced no files) AND in the reduced-prompt fallback (Validation: builder produced no files). Slice cannot proceed.)
- missionId=tjZfi-ogxfm0AYdG, projectId=njfwxAWw5YPw, phase=qa-gate, step=qa-gate:pipeline-not-completed, reason=Pipeline did not reach 'completed' state (state=failed, error=Critical step "Build" failed: Builder produced 0 files in primary attempts (VALIDATION_ERROR: Validation: builder produced no files) AND in the reduced-prompt fallback (Validation: builder produced no files). Slice cannot proceed.)

### contract rejection
- classification: systemic
- missionId=00tTrwdtD9xiEZXK, projectId=1J-JhsBGjqSk, phase=final-assembly, step=final-assembly:deterministic-contract, reason=Deterministic generation contract FAILED: dangling internal import: src/app/logout/page.test.tsx -> './page'
- missionId=cTxxcKrzp-sP4cWN, projectId=IVxGokIB-J-5, phase=final-assembly, step=final-assembly:deterministic-contract, reason=Deterministic generation contract FAILED: dangling internal import: src/app/api/users/route.test.ts -> '@/lib/db' | dangling internal import: src/app/api/users/route.test.ts -> '@/lib/auth'
- missionId=awZJAsHaCLsPKzJg, projectId=lHGph30_xe5Z, phase=final-assembly, step=final-assembly:deterministic-contract, reason=Deterministic generation contract FAILED: dangling internal import: app/page.tsx -> '../components/HeroBanner' | dangling internal import: app/page.tsx -> '../components/ConfirmationState' | dangling internal import: app/page.tsx -> '../components/ErrorAlert' | dangling internal import: app/page.tsx -> '../components/LoadingSpinner' | dangling internal import: app/page.tsx -> '../components/ui/Button'
- missionId=nI9bP-y1iaSlE5zW, projectId=junlM8QtIiUH, phase=final-assembly, step=final-assembly:deterministic-contract, reason=Deterministic generation contract FAILED: dangling internal import: src/app/api/metrics.kpis/route.test.ts -> './route'

### other
- classification: one-off
- missionId=AjpdbLi7t_5JCoQL, projectId=BBFpwKZtyWHb, phase=qa-gate, step=qa-gate:report-not-passed, reason=QA gate failed: score 95/100 (blockers=none)

## Root Cause Summary
- Primary systemic failure cluster is deterministic contract rejection (dangling internal imports), concentrated in final-assembly.
- Secondary systemic failure cluster is builder-empty during qa-gate pipeline completion path.
- One-off orchestration failure observed: QA gate reported fail at score threshold despite no blockers.

