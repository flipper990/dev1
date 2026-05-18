# Design System Fixes

## Token and Foundation Hardening
- Added shell-level viewport tokens in `theme.css`:
  - `--shell-header-offset`
  - `--shell-content-min-height`
  - `--workspace-dock-clearance`
  - `--safe-bottom`
- Added stable scrollbar behavior with `scrollbar-gutter: stable`.
- Added missing `display-s` typography token in Tailwind config.

## Visual Consistency Improvements
- Unified shell spacing rhythm and panel heights using shared variables.
- Tightened radius and spacing usage across tabs, nav items, and pipeline cards.
- Improved active state borders/backgrounds for left nav, reducing ambiguous hover/active styling.
- Upgraded glass surfaces for drawer/dock consistency with shared `studio-glass` treatment.

## Motion and Interaction Consistency
- Standardized width/spacing transitions in collapsible left nav.
- Improved command dock and tab interactive target spacing for pointer and keyboard usage.
- Added body scroll-lock behavior to overlays (nav drawer, context drawer, modal) for operational stability.

## Theme/Hydration Stability
- Added pre-hydration theme bootstrap script in root layout.
- Persisted selected theme to localStorage from shell runtime.
