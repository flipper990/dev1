# UX Problems Report (Current State)

## Severity Legend
- P1: High impact / workflow blocking / trust-damaging.
- P2: Medium impact / significant friction.
- P3: Low impact / polish or clarity issue.

## P1 Issues

### P1-01: Core business/admin flows are visible but non-functional
Where:
- `/billing`, `/deployments`, `/settings` (persistence), `/request-demo`, `/waitlist`, parts of workspace setup/invite acceptance.

Evidence:
- Multiple screens intentionally render disabled controls and warning panels due missing backend contracts.

Impact:
- Users can navigate into dead-end control surfaces.
- Perceived reliability drops, especially in enterprise evaluation contexts.

### P1-02: Onboarding-to-execution continuity is fragmented
Where:
- `/onboarding`, `/onboarding/first-project`, `/workspaces`, `/workspaces/new`.

Evidence:
- Forms and actions are often intentionally disabled; continuation relies on conceptual guidance rather than successful completion.

Impact:
- New users may not successfully transition from learning to doing.

### P1-03: Capability communication is duplicated and scattered
Where:
- Repeated warning banners and inline status panels across multiple routes.

Evidence:
- Similar “requires endpoint” messages repeated with page-specific wording.

Impact:
- Increases cognitive load and maintenance burden.
- Inconsistent messaging risk as platform evolves.

## P2 Issues

### P2-01: Card density causes cognitive fatigue
Where:
- `/overview`, `/agents`, `/workspace` evidence panel, several marketing sections.

Evidence:
- High number of bordered cards/panels in single viewports.

Impact:
- Harder visual scanning and slower prioritization.

### P2-02: Workspace evidence can become overwhelming on mobile
Where:
- `/workspace` with evidence expanded and tab content deep.

Evidence:
- Preview + command + collapsible tabs + nested cards/logs/timelines in one linear scroll path on small screens.

Impact:
- High interaction cost and reduced discoverability.

### P2-03: Activity screen detail density is high
Where:
- `/agents`

Evidence:
- KPI cards + timeline + metadata side panel + record list.

Impact:
- Strong information value but steep cognitive load, especially for non-expert users.

### P2-04: Global command interaction is useful but discoverability-limited
Where:
- Top bar command bar.

Evidence:
- Supports route aliases/search but no command explorer or visible command inventory.

Impact:
- Power feature exists, but depth is hidden for many users.

### P2-05: No dedicated large-scale project data view
Where:
- `/projects`

Evidence:
- Card-grid only approach; no table/dense list mode.

Impact:
- Less efficient at higher project counts.

## P3 Issues

### P3-01: Token/utility drift in typography
Evidence:
- `text-display-s` appears in components while not defined in Tailwind config.

Impact:
- Style inconsistency risk and maintainability debt.

### P3-02: Notification affordance with no functionality
Where:
- Top bar bell icon is present but disabled.

Impact:
- Mild expectation mismatch.

### P3-03: Docs search is visible but disabled
Where:
- Docs layout search box.

Impact:
- Minor frustration; expectation of search capability is not met.

### P3-04: Repeated warning copy tone can feel defensive
Where:
- Many placeholder-capability pages.

Impact:
- Product confidence perception slightly reduced despite transparency intent.

## Enterprise UX-Specific Concerns

### EUX-01: Capability gating is UI-copy driven, not model-driven
Current approach:
- Pages manually render warnings and disable controls.

Risk:
- Hard to scale as permissions/tiers/features grow.

### EUX-02: No unified cross-page readiness state model shown to user
Current approach:
- Status context exists per page, but platform-wide “what is live vs unavailable” view is not centralized.

Risk:
- Admin users cannot quickly understand platform operational readiness.

### EUX-03: No explicit permissions matrix in UI
Current approach:
- Role references exist in data/session models, but no robust admin permission UI is implemented.

Risk:
- Enterprise governance workflows remain incomplete.

## “AI Demo Feeling” Risk Areas

Areas with risk:
- Disabled intake pages (`/request-demo`, `/waitlist`) if entered with intent to transact.
- Workspace setup flows with non-functional submit endpoints.

Areas that avoid this risk well:
- `/workspace` preview + evidence architecture.
- `/projects`/`/agents` real status/evidence presentation.

## Recommended Priority Order for Remediation (Without Redesigning Yet)
1. Convert repeated capability warnings into shared capability-state framework.
2. Close onboarding-to-first-project execution gap.
3. Add dense operational mode for projects/activity data.
4. Reduce card saturation and strengthen sectional prioritization in operations pages.
5. Resolve token drift and placeholder affordances (bell/docs search) with explicit roadmap state.
