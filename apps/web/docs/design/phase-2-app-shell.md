# Phase 2 App Shell

## Intent
Create a calmer, premium application frame where delivery work is the primary surface and operational context is progressive, not always-on.

## Shell Structure
- Top bar: brand, global search, workspace context, notifications, theme toggle, account menu.
- Left navigation rail: Home, Projects, Agents, Deployments, Billing, Settings.
- Main content canvas: page header + page-specific work area.
- Right context drawer: optional trust/activity/metadata surface, collapsible by default.

## Key Behaviors
- Light-first layout with border-first containment and low visual noise.
- Main canvas uses bounded max widths for readability.
- Context drawer is explicit and user-controlled, not permanently noisy.
- Mobile navigation and context surfaces shift to overlays.

## Components Delivered
- `AppShell`
- `TopBar`
- `LeftNav`
- `ContextDrawer`
- `PageHeader`
- `Breadcrumbs`
- `GlobalSearch`
