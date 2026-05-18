# UI FRONTEND AUDIT

Date: 2026-05-18

## Scope
- Next.js app-router structure
- routes/pages/layout/shell/components
- consistency/responsiveness/dead or placeholder UI

## Structure
- Single Next.js app with route-level shell composition.
- Route coverage is broad (workspace, auth, marketing, docs, onboarding, settings/security/billing/deployments).
- UI system uses tokenized theme and reusable primitives.

## Findings

### Strengths
1. Clear shell architecture (`MarketingShell`, `AuthShell`, `AppShell`).
2. Design system is coherent (theme variables + Tailwind mapping + shared components).
3. Workspace-focused UX modules are organized under `src/features/workspace`.

### Broken or High-Impact UX Issues
1. Redirect flow can drop query context for protected routes (user returns without prior project/tab state).
2. Primary left-nav action "New mission" appears as dead button (no execution path).
3. Navigation duplication maps two entries to `/agents`, creating IA confusion.

### Placeholder / Partial Areas
1. Deployments page explicitly placeholder.
2. Billing page non-functional placeholder.
3. Settings page read-only shape, not persisted.
4. Request-demo and waitlist forms intentionally disabled.
5. Docs search control rendered as placeholder.
6. Auth UI still contains disabled/blocked actions.

### Consistency/Design Debt
1. Mixed component roots (`apps/web/components` and `apps/web/src/components`).
2. Branding labels vary by shell/context.
3. Some fixed-width panel choices likely stress narrower laptop widths.

## Status Summary
- Core UI framework: Real.
- Production-complete UX: Partial.
- Placeholder/dead UI debt: Significant.

## Recommendation
Prioritize removing dead-end controls, unifying navigation semantics, and clearly separating placeholder product surfaces from active production routes.
