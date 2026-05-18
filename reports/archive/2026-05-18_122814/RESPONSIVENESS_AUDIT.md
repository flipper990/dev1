# Responsiveness Audit

## Breakpoints Verified
- Mobile (`<768px`)
- Tablet (`768px-1023px`)
- Desktop (`1024px-1535px`)
- Ultrawide (`>=1536px`)

## Findings and Fixes
- Shell vertical sizing:
  - Replaced brittle fixed `vh` calculations with CSS variables based on `100dvh`.
  - Added `--shell-header-offset` profiles for multi-row vs single-row header modes.
- Left navigation:
  - Improved sticky sizing and collapsed width transition behavior.
  - Prevented nav clipping by normalizing shell content height and scroll regions.
- Mobile navigation drawer:
  - Anchored below dynamic shell header offset.
  - Added safe-area bottom support and body scroll lock.
- Context drawer:
  - Anchored below dynamic shell header offset.
  - Added body scroll lock and safe-area bottom padding.
- Workspace command dock:
  - Changed from always-fixed to `relative` on small viewports and fixed on `md+`.
  - Added safe-area bottom handling, horizontal quick-command scrolling, and textarea height limits.
- Main workspace content:
  - Added consistent bottom clearance based on dock-safe spacing token.
  - Preserved no-horizontal-overflow behavior.
- Preview viewport:
  - Normalized device viewport heights with clamp-based sizing to reduce clipping and dead-space extremes.

## Remaining Risk Notes
- Runtime iframe content can still introduce internal scroll behavior unrelated to host shell; host boundaries are now stable.
