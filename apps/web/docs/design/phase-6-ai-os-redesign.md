# Phase 6 - AI Engineering OS Redesign

## 1) Layout Architecture
- Left: collapsible icon-first runtime dock (`LeftNav`) with quick action trigger.
- Center: dominant operational workspace (`AppShell` main stage + `WorkspaceMainPanel` preview-first layout).
- Bottom center: floating orchestration console (`CommandDock`) fixed to viewport.
- Right: persistent live pipeline rail (`AgentPipelineRail`) rendered through `AppShell` context panel.

## 2) Updated Shell System
- `AppShell` now renders a persistent three-zone operating environment instead of page-like content.
- `TopBar` is reduced to runtime metadata, health, and command access.
- Context content is persistent on desktop and drawer-based on smaller breakpoints.
- Mobile navigation remains dialog-based and focus-trapped.

## 3) Navigation Redesign
- `LeftNav` is icon-first, minimal text, dock-like spacing, and compact hover behavior.
- Added runtime-focused items (deployments, agent runtime) and quick "new mission" action.
- Collapse mode now supports tooltip-driven icon navigation.

## 4) Workspace Composition
- Preview canvas remains the largest visual anchor (`PreviewCanvasFrame` upgrades for cinematic depth).
- Evidence section remains collapsible to preserve focus.
- Project context selection and state header are streamlined (`WorkspaceHeader`).
- Semantic status and evidence-first data flow are preserved.

## 5) Command Dock Redesign
- `CommandDock` is now a centered floating glass console.
- Supports slash-like quick command chips and explicit execution mode states.
- Keeps non-chat framing and accelerator behavior (`Ctrl/Cmd+Enter`).
- Uses project-bound context labels and mission-oriented action language.

## 6) Agent Pipeline Redesign
- New `AgentPipelineRail` surfaces:
  - live execution counters
  - step stream with owner/state/evidence
  - trust channel summary tied to semantic status
- Rendered persistently in the right shell rail for orchestration transparency.

## 7) Design Token Strategy
- Dark-first cinematic token baseline in `src/styles/theme.css`.
- Introduced layered utilities:
  - `.studio-canvas`
  - `.studio-surface`
  - `.studio-surface-soft`
  - `.studio-glass`
  - `.studio-scroll`
- Increased radius scale and shadow depth to reduce card-border noise.
- Kept semantic status tokens intact for existing state system.

## 8) Motion + Interaction
- Preserved reduced-motion safety behavior.
- Expanded transition usage with existing semantic durations/easing.
- Added pulse/spin state cues in pipeline execution and runtime widgets.

## 9) Responsive Behavior Plan
- `< xl`: right pipeline remains available via context drawer toggle.
- `lg+`: left dock is persistent; mobile keeps focus-trapped nav overlay.
- Bottom command console uses adaptive width and safe-margin anchoring.
- Main stage keeps scroll isolation so preview + evidence remain usable.

## 10) Implementation Roadmap
1. Finalize visual QA at `1280`, `1440`, `1920`, and mobile portrait widths.
2. Run route smoke and a11y smoke scripts after design stabilization.
3. Add websocket/stream hooks to `AgentPipelineRail` for real-time deltas.
4. Introduce animation variants (node enter/exit, timeline transitions) with reduced-motion fallbacks.
5. Expand command dock contextual actions from static chips to command grammar.

