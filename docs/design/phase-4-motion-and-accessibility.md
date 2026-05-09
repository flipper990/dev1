# Phase 4 Motion And Accessibility

## Motion principles
- Motion is informative, not decorative.
- State transitions should clarify hierarchy and feedback timing.
- Retry/loading indicators stay subtle.
- Respect `prefers-reduced-motion` globally.

## Implemented motion behavior
- Retry toast supports reduced-motion variant (`reducedMotion=true`).
- Existing global reduced-motion CSS disables animations and transitions.

## Accessibility requirements covered
- Keyboard operability for all recovery actions.
- Focus trapping and Escape close in `Modal`.
- Live-region announcements in banners/toasts and workspace status updates.
- Icon-only controls carry explicit `aria-label`.
- State communication includes text labels, not color alone.

## Ongoing checks
- Verify focus order in overlays and drawers.
- Validate contrast in warning/error subtle backgrounds.
- Keep semantic landmarks and headings consistent.
