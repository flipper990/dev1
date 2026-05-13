# Current Layout Map

## A) Shell Map

### 1. Marketing Shell (`MarketingShell`)
Used by:
- `/`, `/product`, `/pricing`, `/enterprise`, `/security`, `/request-demo`, `/waitlist`

Layout stack:
1. Sticky marketing header with brand + nav + CTA buttons.
2. Main content sections (`MarketingSection`) in max width containers.
3. Marketing footer with link groups.

Mobile behavior:
- Secondary horizontal scrolling nav row below header.
- CTA remains visible in top header.

### 2. App/Product Shell (`AppShell`)
Used by:
- `/overview`, `/projects`, `/workspace`, `/agents`, `/billing`, `/settings`, `/deployments`

Desktop composition:
1. Sticky top bar (workspace, command bar, status badges, user actions).
2. Left sidebar (sectioned nav, collapsible).
3. Main content column.
4. Optional right context drawer overlay.

Mobile composition:
1. Top bar with hamburger.
2. Full-height left slide-over nav modal.
3. Command bar moved to dedicated row under top bar.

### 3. Auth Shell (`AuthShell`)
Used by:
- `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/accept-invite`
- `/onboarding`, `/onboarding/first-project`, `/workspaces`, `/workspaces/new`

Desktop composition:
- Two-column split: branded explanatory aside + form/content panel.

Mobile composition:
- Aside hidden.
- Single centered card form.

### 4. Docs Layout (`DocsLayout`)
Used by:
- `/docs`, `/docs/[slug]`, `/how-it-works`

Desktop composition:
1. Hero header strip.
2. 3-column body: left docs sidebar, content, right table-of-contents rail.

Mobile composition:
- Side rails collapse; content-first reading flow.

## B) Route-by-Route Screen Map

### Public / Marketing
- `/`
  - Hero split (copy + proof visual), then proof/workflow/comparison/use cases/pricing preview/trust/FAQ/final CTA.
- `/product`
  - Capability list + screenshot stack, lifecycle, output proof, ownership callout.
- `/pricing`
  - Plan cards + comparison + billing availability notice.
- `/enterprise`
  - Trust strip, fit proof strip, export posture callout.
- `/security`
  - Trust band, review proof strip, ownership/trust callout.
- `/request-demo`
  - Left “demo covers” card + right disabled intake form with warning banner.
- `/waitlist`
  - Fit criteria card + disabled intake form with warning badge.

### Documentation
- `/docs`
  - Docs hub card + article card grid.
- `/docs/[slug]`
  - Article header, section content blocks, related articles, left nav, right TOC.
- `/how-it-works`
  - Alias-like doc article rendering (`project-lifecycle`).

### Auth / Onboarding / Workspace Setup
- `/login`
  - Auth availability banner, email/password fields, disabled SSO button, links.
- `/signup`
  - Name/email/password with validation + status.
- `/forgot-password`
  - Email form; may expose dev token link.
- `/reset-password`
  - Token + password reset fields.
- `/verify-email`
  - Verification panel with verify/resend actions.
- `/accept-invite`
  - Invite context panel + disabled accept action.
- `/onboarding`
  - Concept cards + continue CTA.
- `/onboarding/first-project`
  - Brief + stack + verification focus + disabled creation action.
- `/workspaces`
  - Workspace options as disabled list + link to create.
- `/workspaces/new`
  - Workspace form shell + disabled submit.

### Core Product / Operations
- `/overview`
  - Header + context drawer; hero, status summary, usage summary, recent projects, recent activity, support/docs shortcuts.
- `/projects`
  - Filter/search card; usage summary; project card grid or empty state.
- `/workspace`
  - Status banner + workspace header.
  - Primary preview canvas frame (device toggle/open/copy/retry).
  - Command dock.
  - Collapsible evidence section with tabs:
    - Overview, Preview details, Build, Verify, Activity, Logs, Export/Launch.
- `/agents`
  - Error/stale banners, KPI cards, timeline panel, selected artifact card, recent records list.
- `/billing`
  - Warning status panel + non-functional billing cards.
- `/settings`
  - Warning banner + read-only setting cards + setup stepper.
- `/deployments`
  - Warning panel + empty state (backend missing).

## C) Navigation Positioning

### Top Bar
Contains:
- Brand, workspace/project context chip, global command bar, platform health badge, notification icon (disabled), theme toggle, auth/user control.

### Left Sidebar
Sections:
- Studio: Overview, Projects, Workspace/Builder.
- Operations: Activity, Diagnostics, Docs.
- Administration: Billing, Settings, Security/Admin.

### Context Drawer
- Right overlay panel for page-specific contextual metadata.
- Used heavily in operational pages as an evidence/contract side rail.

## D) Workspace Panel Architecture

`/workspace` panel hierarchy:
1. **Status area**
   - System banner (reconnect/stale/not found/loading).
   - Workspace header (project select + status + action).
2. **Primary artifact zone**
   - PreviewCanvasFrame.
3. **Action zone**
   - CommandDock (create/change request).
4. **Secondary evidence zone**
   - Collapsible container.
   - Tabbed evidence and controls.

This layout makes preview the primary review artifact and defers diagnostics/logs/export details until explicitly expanded.

## E) Responsive Behavior Map

### Breakpoint Patterns
- `md`: promotes command bar and richer top bar context.
- `lg`: introduces persistent left nav / desktop multi-column grids.
- `xl`: heavier split layouts for operations dashboards.

### Mobile-Specific Adjustments
- Sidebar becomes modal drawer.
- Command bar moves below top bar.
- Marketing nav becomes horizontal scroll strip.
- Many multi-column sections collapse to stacked cards.

### Known Mobile Stress Points
- Workspace evidence tabs + dense cards can become long-scroll heavy.
- Activity page side panels and timeline density increase cognitive load on narrow viewports.
