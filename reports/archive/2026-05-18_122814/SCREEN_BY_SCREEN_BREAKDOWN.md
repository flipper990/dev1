# Screen-by-Screen Breakdown (Current State)

## Legend
- Shell: `MarketingShell`, `AppShell`, `AuthShell`, `DocsLayout`.
- Backend status: `Live`, `Partially Live`, `Placeholder/Blocked`.

## 1. `/` Landing
- Shell: MarketingShell
- Purpose: Product positioning and acquisition.
- Layout: Hero split, proof strip, lifecycle, comparison, use-case grid, trust sections, FAQ, final CTA.
- Key components: `MarketingSection`, `ProofVisual`, `LifecycleDiagram`, `ComparisonTable`, `UseCaseGrid`, `OwnershipCallout`.
- Interactions: CTA navigation only.
- Backend status: Placeholder-independent (content-driven).
- Notes: High narrative clarity.

## 2. `/product`
- Shell: MarketingShell
- Purpose: Product capability explanation.
- Layout: Capability rail + screenshot stack + workflow + output + ownership.
- Components: `StackedProductScreenshots`, `ProofStrip`, `ComparisonTable`.
- Backend status: Content-driven.

## 3. `/pricing`
- Shell: MarketingShell
- Purpose: Pricing framing and access model.
- Layout: Plan rows + comparison + billing availability section.
- Components: `CTAButton`, `ProofStrip`.
- Backend status: Placeholder for transactional billing.
- Notes: Explicitly signals no checkout backend.

## 4. `/enterprise`
- Shell: MarketingShell
- Purpose: Enterprise positioning.
- Layout: Trust strip, fit proof, ownership callout.
- Backend status: Content-driven.

## 5. `/security`
- Shell: MarketingShell
- Purpose: Trust/security posture messaging.
- Layout: Trust band + review strip + callout.
- Backend status: Content-driven.

## 6. `/request-demo`
- Shell: MarketingShell
- Purpose: Demo lead intake.
- Layout: Left explanation card, right disabled form.
- Components: `SystemBanner`, disabled inputs/select/textarea.
- Backend status: Placeholder/Blocked.
- UX note: Clear transparency, but dead-end action.

## 7. `/waitlist`
- Shell: MarketingShell
- Purpose: Early access intake.
- Layout: Fit card + disabled form.
- Backend status: Placeholder/Blocked.

## 8. `/docs`
- Shell: DocsLayout (inside MarketingShell)
- Purpose: Docs hub.
- Layout: Header + left nav + article grid + right rail (desktop).
- Components: `DocsHub`, docs cards.
- Backend status: Live static content.

## 9. `/docs/[slug]`
- Shell: DocsLayout
- Purpose: Article detail.
- Layout: Article card with section anchors, related articles, docs nav rails.
- Components: `DocsArticleView`.
- Backend status: Live static content.

## 10. `/how-it-works`
- Shell: DocsLayout
- Purpose: Shortcut to project lifecycle doc.
- Backend status: Live static content.

## 11. `/login`
- Shell: AuthShell
- Purpose: Authenticate user.
- Layout: Two-column auth presentation (desktop), form card.
- Components: `LoginForm`, `AuthStatus`.
- Backend status: Partially Live (depends on auth API health).

## 12. `/signup`
- Shell: AuthShell
- Purpose: Account creation.
- Components: `SignupForm` with validation.
- Backend status: Partially Live.

## 13. `/forgot-password`
- Shell: AuthShell
- Purpose: Password recovery initiation.
- Components: `ForgotPasswordForm`.
- Backend status: Partially Live.

## 14. `/reset-password`
- Shell: AuthShell
- Purpose: Password reset completion.
- Components: `ResetPasswordForm`.
- Backend status: Partially Live.

## 15. `/verify-email`
- Shell: AuthShell
- Purpose: Email verification.
- Components: `VerifyEmailPanel`.
- Backend status: Partially Live.

## 16. `/accept-invite`
- Shell: AuthShell
- Purpose: Accept workspace invite.
- Components: `AcceptInviteForm`.
- Backend status: Placeholder/Blocked (accept action disabled).

## 17. `/onboarding`
- Shell: AuthShell
- Purpose: Concept onboarding.
- Layout: concept cards + continue CTA.
- Backend status: Content-driven.

## 18. `/onboarding/first-project`
- Shell: AuthShell
- Purpose: First project brief/stack setup.
- Components: `FirstProjectSetupForm`.
- Backend status: Placeholder/Blocked (creation disabled).

## 19. `/workspaces`
- Shell: AuthShell
- Purpose: Workspace selection.
- Components: `WorkspaceSelectionForm`.
- Backend status: Placeholder/Blocked (workspace actions disabled).

## 20. `/workspaces/new`
- Shell: AuthShell
- Purpose: Workspace creation form.
- Backend status: Placeholder/Blocked.

## 21. `/overview`
- Shell: AppShell
- Purpose: Executive/project operations summary.
- Layout: Hero -> status + usage -> recent projects + activity/support rail.
- Components: `DashboardHero`, `ProjectStatusSummary`, `UsageSummary`, `RecentProjects`.
- Backend status: Live with stale/reconnect handling.

## 22. `/projects`
- Shell: AppShell
- Purpose: Portfolio management.
- Layout: filters + usage summary + project card grid.
- Components: `ProjectFilters`, `ProjectList`, `ProjectCard`.
- Backend status: Live.

## 23. `/workspace`
- Shell: AppShell via `WorkspacePageShell`
- Purpose: Primary production workbench.
- Layout:
  1. banner + project selector/status.
  2. preview frame.
  3. command dock.
  4. collapsible evidence tab area.
- Tabs: Overview, Preview details, Build, Verify, Activity, Logs, Export/Launch.
- Components: `PreviewCanvasFrame`, `CommandDock`, `DiagnosticsSummary`, `ExportActionPanel`, `TrustRail`.
- Backend status: Live core workflow (create/change/preview/export) with real-time polling/ws hybrid.

## 24. `/agents`
- Shell: AppShell
- Purpose: Agent/pipeline activity evidence.
- Layout: banners + KPI cards + timeline + side metadata panels.
- Components: `ProductionTimeline`, `StatusDot`, `Panel`, `Card`.
- Backend status: Live/partial (falls back between session progress, preview timeline, project history).

## 25. `/billing`
- Shell: AppShell
- Purpose: Billing management.
- Layout: warning panel + placeholder summary cards.
- Backend status: Placeholder/Blocked.

## 26. `/settings`
- Shell: AppShell
- Purpose: Workspace settings.
- Layout: warnings + read-only identity/default cards + setup stepper.
- Components: `SetupStepper`.
- Backend status: Placeholder/Blocked for persistence.

## 27. `/deployments`
- Shell: AppShell
- Purpose: Deployment/release management.
- Layout: warning panel + empty state.
- Backend status: Placeholder/Blocked.

## 28. `/billing` context drawer content
- Purpose: Explain missing billing contract and state.
- Notes: Good transparency, no actionable execution path.

## 29. `/settings` context drawer content
- Purpose: Explain read-only settings state and required API.

## 30. `/deployments` context drawer content
- Purpose: Explain missing deployment backend.

## 31. `/overview` context drawer content
- Purpose: Show timeline/evidence metadata.

## 32. `/projects` context drawer content
- Purpose: Explain project data source/debug behavior.

## Cross-Screen Behavior Notes
- Protected-route intent enforced by middleware cookie checks.
- Stale/reconnecting states are surfaced consistently with banners.
- Status language is heavily evidence-centric (projectId, preview transport/health, verification).
- Many non-core workflows intentionally remain in “announced but disabled” state.
