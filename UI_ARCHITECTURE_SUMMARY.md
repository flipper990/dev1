# UI Architecture Summary (Current State)

## Scope and Method
This document describes the current UI/UX architecture implemented in `apps/web` (Next.js App Router). It is a code-derived snapshot of the platform before redesign.

## 1) Platform Structure

### Application Surfaces
The platform is split into 3 major UI shells:
1. Marketing shell (`MarketingShell`) for public/product pages.
2. Product shell (`AppShell`) for authenticated workspace operations.
3. Auth shell (`AuthShell`) for identity/onboarding entry flows.

### Route Inventory
Implemented routes:
- Public marketing/product: `/`, `/product`, `/pricing`, `/enterprise`, `/security`, `/how-it-works`, `/request-demo`, `/waitlist`
- Documentation: `/docs`, `/docs/[slug]`
- Auth/account: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/accept-invite`
- Onboarding/workspace setup: `/onboarding`, `/onboarding/first-project`, `/workspaces`, `/workspaces/new`
- Core app (authenticated intent): `/overview`, `/projects`, `/workspace`, `/agents`, `/billing`, `/settings`, `/deployments`

### Navigation and IA Model
Primary app IA is shallow and functional:
- Studio: Overview, Projects, Workspace/Builder
- Operations: Activity, Diagnostics (workspace logs), Docs
- Administration: Billing, Settings, Security/Admin

Navigation implementation:
- Desktop: persistent left sidebar + sticky top bar.
- Mobile: top bar + modal slide-over navigation.
- Global command bar supports route shortcuts and search forwarding.

### Workspace/Project Hierarchy
Current hierarchy model is:
- Workspace (conceptual container)
- Projects (portfolio list)
- Project detail/workbench (`/workspace?projectId=...`)

Identity source of truth is `projectId`. UI repeatedly reinforces that names are labels and actions bind to IDs.

### Main Workflows
1. Discovery and positioning flow:
   - Landing/product pages -> docs/demo/waitlist.
2. Auth and onboarding flow:
   - Login/signup/recovery/verify/invite -> onboarding pages.
3. Build workflow (core product):
   - Projects -> Workspace -> command submission (create/change) -> build -> preview -> verify -> export.
4. Activity/evidence workflow:
   - Activity page combines session progress, persisted preview timeline, and prompt history.
5. Documentation workflow:
   - Docs home -> article -> related article navigation.

### Backend-Aware Availability Pattern
A strong current-state pattern exists: missing backend contracts are explicitly surfaced. Many screens intentionally show read-only/disabled controls with warning banners (billing, settings persistence, deployments, waitlist intake, request demo intake).

## 2) Visual Design Assessment

### Design Style
Current style is “calm enterprise SaaS with editorial warmth”:
- Warm neutral canvas (`#F6F4EF`) rather than pure white.
- Muted green primary with gold secondary accents.
- Rounded but restrained geometry.
- Dense use of bordered cards/panels with soft shadows.

### SaaS Maturity Signal
Feels beyond prototype in structure and consistency of primitives, but not fully production-complete in business workflows due to intentionally missing backend integrations.

### Visual Hierarchy
Hierarchy quality is generally good:
- Shell-level hierarchy: Top bar -> page header -> content sections.
- Workspace hierarchy explicitly prioritizes preview as primary artifact.
- Secondary evidence is collapsible in workspace (good information prioritization).

Weaknesses:
- Many pages use similar card/panel density, making some surfaces visually samey.
- Some page-specific emphasis depends on text rather than distinct layout rhythm.

### Typography System
- Fonts: Inter + IBM Plex Mono.
- Tokenized scale in Tailwind/theme.
- Consistent use of label/body/title tokens.

Issue: usage includes classes like `text-display-s` that are not defined in `tailwind.config.ts`, indicating token/utility drift.

### Color System
- Semantic tokens for brand, surfaces, borders, text, status.
- Proper light and dark token sets.
- Status semantics consistently represented in badges and dots.

### Dark/Light Handling
- Dark mode token set exists and is runtime-toggleable in app shell.
- Root theme class/data attribute toggled by shell logic.
- Marketing/auth screens inherit tokenized styling.

Limitations:
- No persisted user theme preference strategy beyond local experiment/flag behavior.
- Dark mode exposure is feature-flag dependent.

### Spacing/Radius/Elevation Consistency
- Strong tokenized spacing/radius/shadow use.
- Layout spacing is mostly consistent across shell surfaces.
- Card/panel system is coherent.

Minor inconsistency:
- Some pages still mix bespoke spacing/rhythm and can feel denser than others.

### Responsiveness
Implemented breakpoints are extensive:
- Mobile nav drawer, mobile command bar row, responsive grids, overflow-safe tab/nav regions.
- Preview device simulation (desktop/tablet/mobile widths).

Gaps:
- Some dense operational screens (agents/workspace evidence) still become cognitively heavy on small screens.
- Marketing table patterns degrade but still rely heavily on stacked text blocks.

## 3) Component System (Current)

### Foundation Primitives
Reusable primitives exist for:
- `Button`, `IconButton`
- `Input`, `Textarea`, `Select`
- `Card`, `Panel`, `EmptyState`, `Skeleton`
- `Badge`, `StatusDot`
- `Tabs`, `Tooltip`
- Feedback: `SystemBanner`, `InlineStatusPanel`, `Toast`, `Modal`, `RecoveryActions`

Quality is solid and mostly consistent with semantic states and focus handling.

### Shell Components
- `AppShell`, `TopBar`, `LeftNav`, `PageHeader`, `ContextDrawer`, `GlobalCommandBar`
- `MarketingShell`
- `AuthShell`

Shell composition is one of the strongest parts of the current platform.

### Feature Components
Operational features are modularized:
- Workspace: header/status/main panel/tabs/command dock/diagnostics/export/trust rail
- Projects: list/card/filters/status/timeline/usage/checklists
- Activity: production timeline
- Logs: grouped evidence viewer
- Docs: layout/sidebar/article model

### Reusability and Consistency
Good:
- Shared primitives are reused broadly.
- Status semantics are unified across many surfaces.
- Predictable card/panel composition patterns.

Needs attention:
- Some components encode product policy directly in UI copy instead of deriving from centralized capability metadata.
- Several “placeholder backend missing” pages duplicate similar warning language patterns.

## 4) Layout Analysis

### Global Screen Composition
App shell (desktop):
1. Sticky top bar.
2. Left fixed/collapsible nav.
3. Main content region with page header + body.
4. Optional right context drawer overlay.

Workspace page composition:
1. Banner + workspace header (project selector + status).
2. Preview canvas (primary artifact).
3. Command dock.
4. Collapsible evidence zone with tabs.

This is a clear and defensible editor/workbench layout.

### Dashboard and Portfolio Layouts
- Overview: hero + summary + recent activity + support shortcuts.
- Projects: filter rail + usage summary + card grid.
- Activity: metrics cards + timeline + artifact side column.

### AI Interaction Layout
AI interaction is command-driven, not chat-driven:
- Command dock accepts scoped create/change requests.
- Explicit message says this is not a general chat surface.
- Evidence-led workflow (preview/logs/verification) is prioritized over conversational UI.

## 5) UX Analysis (Current Issues)

### Strengths
- Clear product intent: software production over “AI demo chat”.
- Strong transparency around unavailable backend capabilities.
- Good status telemetry integration and stale/reconnecting signaling.
- Preview-first design in workspace is correct for artifact review.

### Friction / Weak Points
- Feature incompleteness is highly visible across admin/commercial screens, creating broken-flow perception.
- High card density and repeated warning blocks create visual and cognitive fatigue.
- Some flows terminate in disabled controls instead of actionable alternatives.
- No dedicated marketplace/workspace browser beyond basic workspaces forms; marketplace IA is absent.
- Command bar is useful but not a full command palette (no discoverable action list, no fuzzy action surface).

## 6) Product Feel Classification
Current feel: **late MVP / internal-production hybrid**.

Why:
- Mature shell, design tokens, state modeling, and workflow framing.
- Strong evidence-oriented workspace architecture.
- But substantial platform areas are intentionally non-functional (billing, deployments, settings persistence, intake endpoints), preventing full production-SaaS completeness.

It does **not** feel like a toy; it feels like a serious product architecture with partial backend completion.

## 7) Redesign Readiness

### Keep
- Shell architecture (`AppShell`, nav topology, top bar).
- Workspace preview-first composition.
- Tokenized design foundation.
- Status system and evidence model.

### Redesign/Simplify
- Repeated “missing backend” page patterns should be consolidated into a capability-state framework.
- Reduce card saturation and improve visual differentiation between dashboards vs operational pages.
- Improve mobile information density handling for workspace evidence and activity.
- Resolve token/utility drift (`display-s` usage mismatch).

### Merge/Remove Candidates
- Merge duplicate status explanation patterns in billing/settings/deployments/request-demo/waitlist.
- Consider unifying project and activity evidence summaries where redundant.

### Enterprise-grade Priorities
- Capability matrix and explicit permission/state gating at component level.
- Persistent user preferences (theme/layout).
- Stronger empty/error recovery pathways with direct next-step tooling.

### Consumer-friendlier Priorities
- Reduce operational jargon density on first-touch routes.
- Streamline onboarding and workspace creation to working endpoints or guided simulations.
