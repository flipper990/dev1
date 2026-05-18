# Layout Fixes

## Shell and Grid Architecture
- Updated app shell grid max width and right rail sizing for better workspace dominance.
- Rebased shell min-heights to `--shell-content-min-height` to eliminate panel clipping and sticky jitter.
- Increased workspace main container max width and stabilized right-context column behavior.

## Sidebar System
- Improved collapsed/expanded geometry and transition semantics.
- Refined item spacing, section separation, and active state contrast.
- Fixed route matching to include query-parameter checks (for tab-specific routes).

## Center Workspace
- Added stronger vertical cadence in `WorkspaceMainPanel`.
- Reduced card density and improved readability in pipeline rail and tabs.
- Increased command dock compositional clarity while retaining operational density.

## Prompt Dock / Console
- Responsive mode switch:
  - Inline flow on small screens.
  - Floating fixed dock on medium and larger screens.
- Added safe-area aware bottom placement.
- Improved quick-command overflow handling and command input resizing boundaries.

## Modal/Drawer/Overlay Stability
- Added background scroll locking for modal and context drawer.
- Adjusted context drawer positioning to align with dynamic topbar height.
- Updated mobile navigation drawer to avoid top collision with two-row header mode.
