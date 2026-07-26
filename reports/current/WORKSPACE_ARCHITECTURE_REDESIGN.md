# Workspace Architecture Redesign

## Outcome

The workspace is reorganized as a three-zone engineering workbench:

1. **Persistent navigation** — a compact, stable left rail for Overview, Projects, Workspace, Deployments, Docs, Billing, and Settings.
2. **Central workbench** — one project-focused surface with four first-class modes: Preview, Code, Logs, and Diagnostics.
3. **Project context** — a dedicated right rail for pipeline progress, current status, and supporting evidence. Below 1280px it remains available as a drawer so the workbench keeps sufficient width.

The redesign intentionally does not introduce new enterprise capabilities. It establishes predictable locations for future collaboration, governance, review, deployment, and audit features.

## Major changes

- Removed duplicate Activity, Agent runtime, and Diagnostics destinations from global navigation.
- Replaced “Workspace / Builder” with the direct label “Workspace.”
- Replaced the dead “New mission” control with a working “New project” route.
- Removed internal shell language such as “Mission control,” “Agent runtime,” and “AI Engineering Runtime.”
- Made the selected project the main page identity.
- Removed the duplicated project-level primary action; the page header now owns the primary action.
- Replaced the collapsed seven-tab evidence deck with a visible four-mode workbench.
- Moved Preview from an always-on dominant surface into a peer mode.
- Added a read-only Code workbench backed by existing project file APIs.
- Promoted Logs and Diagnostics to direct workbench modes.
- Preserved legacy tab links by mapping them into the new information architecture.
- Synchronized mode changes to the URL for refresh, history, and sharing.
- Reduced top-bar noise by removing inactive notifications, redundant runtime labels, and passive telemetry decoration.
- Constrained central and right-panel scrolling to create a stable desktop workbench.

## Responsive model

- **1280px and above:** left navigation, central workbench, and inline project context.
- **1024–1279px:** persistent left navigation, central workbench, context drawer.
- **Below 1024px:** navigation and context use drawers; the workbench receives the full viewport width.
- The Code view stacks its file list above source on narrower screens.

## Preserved contracts

- `/workspace` and `projectId` remain canonical.
- Legacy tabs continue to resolve:
  - `overview`, `preview` → Preview
  - `build`, `activity` → Logs
  - `verify`, `export`, `launch` → Diagnostics
- Preview rendering remains bound to the selected project and existing runtime-health model.
- The command dock retains create and follow-up behavior.
- The right panel continues using real pipeline events and status evidence.

## Scope boundary

This iteration changes hierarchy, navigation, naming, panel organization, and workbench structure. It does not add RBAC, approvals, audit logs, collaboration, editable code, diffs, memory management, or deployment governance.
