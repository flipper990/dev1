# Phase 2 Responsive Layouts

## Breakpoints
- `sm`: 640
- `md`: 768
- `lg`: 1024
- `xl`: 1280
- `2xl`: 1536

## Mobile (<768)
- Single-column canvas.
- Left nav as overlay drawer.
- Context panel as right-side overlay with focus trap.
- Top bar includes compact controls and search.

## Tablet (768-1023)
- Left nav present and collapsible.
- Main canvas prioritised.
- Context panel remains overlay, not permanent.

## Desktop (1024-1279)
- Left nav + main canvas.
- Context panel remains optional overlay.
- Wider content spacing for primary tasks.

## Widescreen (>=1280)
- Left nav + main canvas + optional inline context panel.
- Main content constrained by max widths to preserve readability.
- No horizontal overflow, no stretched long-form content lines.

## Accessibility Rules
- Keyboard operable top bar, nav, and drawers.
- Visible focus rings for all interactive controls.
- Drawer overlays support `Escape` close and focus trapping.
