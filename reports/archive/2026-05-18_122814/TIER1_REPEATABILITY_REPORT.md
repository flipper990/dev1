# TIER1_REPEATABILITY_REPORT

## Run Configuration
- Controlled Tier 1 pass with 10 prompts (landing, SaaS dashboard, marketing, portfolio, product, admin overview, docs/help, pricing, waitlist, analytics dashboard).
- Run window: 2026-05-16T12:00:37.114Z to 2026-05-16T13:31:14.337Z
- Harness: `apps/api/src/testing/run-missions-e2e.ts` -> `apps/api/src/testing/successful-mission-e2e.ts`

## Aggregate Metrics
- total missions: 10
- successful missions: 3
- failed missions: 7
- success percentage: 30%
- average runtime (all missions): 543709 ms
- average files generated: 49.5
- preview success rate: 30%
- export success rate: 30%

## Per-Mission Records
### Mission 1
- prompt: Build a simple landing page with hero section, features, and CTA.
- mission ID: U6SWcGQt0-HEHodu
- project ID: QeSL6Iek1Lce
- final status: pass
- filesCount: 49
- previewState: ready
- exportState: ok
- runtime duration: 391969 ms
- retry count: 0
- failureCategory: 
- failurePhase: 
- failureReason: 
- contract violations: none
- build diagnostics: status=warning, verdict=fail, buildErrors=2, runtimeErrors=0, reason=no-progress
- preview diagnostics: status=idle, health=unknown, error=, overlay=, lastStep=container stopped
- export diagnostics: state=ok, ok=True

### Mission 2
- prompt: Build a simple SaaS dashboard with sidebar, KPI cards, and recent activity.
- mission ID: 00tTrwdtD9xiEZXK
- project ID: 1J-JhsBGjqSk
- final status: fail
- filesCount: 36
- previewState: 
- exportState: not_attempted
- runtime duration: 690160 ms
- retry count: 0
- failureCategory: orchestration_failure
- failurePhase: final-assembly
- failureReason: Deterministic generation contract FAILED: dangling internal import: src/app/logout/page.test.tsx -> './page'
- contract violations: dangling internal import: src/app/logout/page.test.tsx -> './page'
- build diagnostics: n/a
- preview diagnostics: n/a
- export diagnostics: state=not_attempted, ok=False

### Mission 3
- prompt: Build a simple marketing website with home, features, and contact sections.
- mission ID: GxSkeMoYmDA2fcy-
- project ID: Soj8JTjgMe25
- final status: fail
- filesCount: 51
- previewState: 
- exportState: not_attempted
- runtime duration: 634313 ms
- retry count: 1
- failureCategory: empty_generation
- failurePhase: qa-gate
- failureReason: Pipeline did not reach 'completed' state (state=failed, error=Critical step "Build" failed: Builder produced 0 files in primary attempts (VALIDATION_ERROR: Validation: builder produced no files) AND in the reduced-prompt fallback (Validation: builder produced no files). Slice cannot proceed.)
- contract violations: none
- build diagnostics: n/a
- preview diagnostics: n/a
- export diagnostics: state=not_attempted, ok=False

### Mission 4
- prompt: Build a simple portfolio site with about, projects list, and contact section.
- mission ID: tjZfi-ogxfm0AYdG
- project ID: njfwxAWw5YPw
- final status: fail
- filesCount: 53
- previewState: 
- exportState: not_attempted
- runtime duration: 591920 ms
- retry count: 1
- failureCategory: empty_generation
- failurePhase: qa-gate
- failureReason: Pipeline did not reach 'completed' state (state=failed, error=Critical step "Build" failed: Builder produced 0 files in primary attempts (VALIDATION_ERROR: Validation: builder produced no files) AND in the reduced-prompt fallback (Validation: builder produced no files). Slice cannot proceed.)
- contract violations: none
- build diagnostics: n/a
- preview diagnostics: n/a
- export diagnostics: state=not_attempted, ok=False

### Mission 5
- prompt: Build a simple product page with product details, features, and buy CTA.
- mission ID: -6SrXV9mCXOmgKHh
- project ID: oot50wM8dB07
- final status: pass
- filesCount: 50
- previewState: ready
- exportState: ok
- runtime duration: 422631 ms
- retry count: 0
- failureCategory: 
- failurePhase: 
- failureReason: 
- contract violations: none
- build diagnostics: status=warning, verdict=fail, buildErrors=2, runtimeErrors=0, reason=no-progress
- preview diagnostics: status=idle, health=unknown, error=, overlay=, lastStep=container stopped
- export diagnostics: state=ok, ok=True

### Mission 6
- prompt: Build a simple admin overview page with summary cards and recent updates.
- mission ID: cTxxcKrzp-sP4cWN
- project ID: IVxGokIB-J-5
- final status: fail
- filesCount: 47
- previewState: 
- exportState: not_attempted
- runtime duration: 882231 ms
- retry count: 0
- failureCategory: orchestration_failure
- failurePhase: final-assembly
- failureReason: Deterministic generation contract FAILED: dangling internal import: src/app/api/users/route.test.ts -> '@/lib/db' | dangling internal import: src/app/api/users/route.test.ts -> '@/lib/auth'
- contract violations: dangling internal import: src/app/api/users/route.test.ts -> '@/lib/db' | dangling internal import: src/app/api/users/route.test.ts -> '@/lib/auth'
- build diagnostics: n/a
- preview diagnostics: n/a
- export diagnostics: state=not_attempted, ok=False

### Mission 7
- prompt: Build a simple docs/help center page with search box and article list.
- mission ID: AjpdbLi7t_5JCoQL
- project ID: BBFpwKZtyWHb
- final status: fail
- filesCount: 56
- previewState: 
- exportState: not_attempted
- runtime duration: 343260 ms
- retry count: 0
- failureCategory: orchestration_failure
- failurePhase: qa-gate
- failureReason: QA gate failed: score 95/100 (blockers=none)
- contract violations: none
- build diagnostics: n/a
- preview diagnostics: n/a
- export diagnostics: state=not_attempted, ok=False

### Mission 8
- prompt: Build a simple pricing page with three plans and feature comparison.
- mission ID: snktMGOrBl2EYpoR
- project ID: B323YQdDkYFp
- final status: pass
- filesCount: 51
- previewState: ready
- exportState: ok
- runtime duration: 333787 ms
- retry count: 0
- failureCategory: 
- failurePhase: 
- failureReason: 
- contract violations: none
- build diagnostics: status=warning, verdict=fail, buildErrors=1, runtimeErrors=0, reason=max-iterations
- preview diagnostics: status=idle, health=unknown, error=, overlay=, lastStep=container stopped
- export diagnostics: state=ok, ok=True

### Mission 9
- prompt: Build a simple waitlist page with email capture form and confirmation state.
- mission ID: awZJAsHaCLsPKzJg
- project ID: lHGph30_xe5Z
- final status: fail
- filesCount: 49
- previewState: 
- exportState: not_attempted
- runtime duration: 280709 ms
- retry count: 1
- failureCategory: orchestration_failure
- failurePhase: final-assembly
- failureReason: Deterministic generation contract FAILED: dangling internal import: app/page.tsx -> '../components/HeroBanner' | dangling internal import: app/page.tsx -> '../components/ConfirmationState' | dangling internal import: app/page.tsx -> '../components/ErrorAlert' | dangling internal import: app/page.tsx -> '../components/LoadingSpinner' | dangling internal import: app/page.tsx -> '../components/ui/Button'
- contract violations: dangling internal import: app/page.tsx -> '../components/HeroBanner' | dangling internal import: app/page.tsx -> '../components/ConfirmationState' | dangling internal import: app/page.tsx -> '../components/ErrorAlert' | dangling internal import: app/page.tsx -> '../components/LoadingSpinner' | dangling internal import: app/page.tsx -> '../components/ui/Button'
- build diagnostics: n/a
- preview diagnostics: n/a
- export diagnostics: state=not_attempted, ok=False

### Mission 10
- prompt: Build a simple analytics dashboard with charts placeholders, metrics, and filters.
- mission ID: nI9bP-y1iaSlE5zW
- project ID: junlM8QtIiUH
- final status: fail
- filesCount: 53
- previewState: 
- exportState: not_attempted
- runtime duration: 866114 ms
- retry count: 0
- failureCategory: orchestration_failure
- failurePhase: final-assembly
- failureReason: Deterministic generation contract FAILED: dangling internal import: src/app/api/metrics.kpis/route.test.ts -> './route'
- contract violations: dangling internal import: src/app/api/metrics.kpis/route.test.ts -> './route'
- build diagnostics: n/a
- preview diagnostics: n/a
- export diagnostics: state=not_attempted, ok=False

## Result
- Minimum required success target (8/10) was **not met**.
- Ideal target (10/10) was **not met**.

