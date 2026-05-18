# UI Issues Report

## Scope Audited
- App shell/layout primitives: `AppShell`, `TopBar`, `LeftNav`, `ContextDrawer`, `Modal`, global theme.
- Workspace core: `WorkspacePageShell`, `WorkspaceMainPanel`, `CommandDock`, `PreviewCanvasFrame`, `AgentPipelineRail`, `WorkspaceHeader`, `WorkspaceTabs`.
- App pages using shared shell: `/overview`, `/projects`, `/workspace`, `/agents`, `/billing`, `/settings`, `/deployments`.

## Critical Issues Found
- Fixed command dock collided with content and mobile viewport/keyboard flow.
- Shell height calculations used static `100vh` math, causing clipping/jitter with multi-row header states.
- Context drawer and modal did not lock background scrolling, creating dual-scroll instability.
- Navigation active-state logic did not respect query-param routes reliably (`/workspace?tab=logs`).
- Token drift in typography scale (`text-display-s` used but missing in Tailwind config).
- Header search row breakpoints and shell offset assumptions were misaligned, producing layout drift.
- Pipeline rail cards were overly dense with weak execution hierarchy.
- Tabs and navigation spacing had inconsistent rhythm and cramped interactive targets.
- Theme initialization could flicker before hydration in light-mode preference scenarios.

## Severity Summary
- High: viewport fit/collision/scroll locking/theme flicker.
- Medium: hierarchy density, spacing drift, nav active-state mismatch.
- Low: visual polish consistency and token completeness.
