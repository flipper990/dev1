# Phase 0: Foundations (Retroactive)

## Purpose
Phase 0 establishes one shared visual and component foundation for all existing DEVteam surfaces without changing IA, routes, or page structure from phases 1–5.

## Design Philosophy
- Professional, calm, software-production-studio tone.
- Light mode is default; dark mode is parity, not a separate style language.
- Token-first styling. Components consume semantic tokens, not raw hex values.
- Border-first containment and restrained elevation.
- Status is explicit, consistent, and reusable across build, preview, health, and launch flows.

## Token System
Source of truth is `apps/web/src/design/tokens/*` and `apps/web/src/styles/theme.css`.

### Color Tokens
- Brand: `primary`, `primaryHover`, `primarySubtle`, `accent`, `accentSubtle`
- Text: `ink`, `textSecondary`
- Surfaces: `surfaceBase`, `surfaceRaised`, `surfaceTint`, `surfaceOverlay`
- Borders: `border`, `borderStrong`
- Feedback: `success`, `successSubtle`, `warning`, `warningSubtle`, `error`, `errorSubtle`, `info`, `infoSubtle`

### Typography
- Families: `Inter` (UI), `IBM Plex Mono` (code/log/ID only)
- Scale:
  - `display-l` 40/48 600
  - `display-m` 32/40 600
  - `title-l` 24/32 600
  - `title-m` 20/28 600
  - `title-s` 18/26 600
  - `body-l` 16/26 450
  - `body-m` 15/24 450
  - `body-s` 14/22 450
  - `label-m` 13/18 550
  - `label-s` 12/16 550
  - `mono-s` 12/18 500

### Spacing
- Canonical scale: `4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96`

### Radius
- Controls: `8px`
- Cards/panels: `12px`
- Modals/preview frames/sheets: `16px`

### Motion
- Hover/press: `80–120ms`
- Small transitions: `140–180ms`
- Drawers/modals: `200–260ms`
- Large layout shifts: `240–320ms`
- Reduced motion support is enforced globally.

## Primitive Component Baseline
Shared primitives in `apps/web/components/ui`:
- `Button`, `IconButton`, `Card`, `Panel`
- `Input`, `Textarea`, `Select`
- `Tabs`, `Badge`, `StatusDot`
- `EmptyState`, `Skeleton`, `Tooltip`
- Feedback primitives re-exported for parity: `Toast`, `Modal`

## Unified Status Presentation
- Status tokens are defined once in `apps/web/src/design/tokens/status.ts`.
- Shared adapters map product status to primitive tones in `apps/web/components/ui/statusPresentation.ts`.
- `Badge` and `StatusDot` support `statusKey` to prevent contradictory local mappings.

## Global Theme Standardization
- Light-first defaults and dark overrides live in `apps/web/src/styles/theme.css`.
- Tailwind semantic integration is in `apps/web/tailwind.config.ts`.
- Legacy compatibility aliases are preserved to avoid route breakage during migration.

## Component Usage Rules
- Use semantic classes (`bg-surface-raised`, `text-ink`, `border-border`, `text-secondary`).
- Avoid new raw hex values in components.
- Use `Badge`/`StatusDot` for state display; avoid ad-hoc status pills.
- Keep sentence case.
- Reserve mono type for code, logs, IDs, and technical metadata.

## Do / Don't
- Do: add tokens first, then consume via primitives.
- Do: centralize state styling via shared status presentation.
- Don't: introduce a second token file or alternate component family.
- Don't: use neon gradients, glow-heavy terminal visuals, or oversized pill-heavy UI.

## Why This Avoids Vibe-Coding Aesthetics
- Removes fragmented one-off status chips and ad-hoc color logic.
- Replaces decorative/glow-centric styles with restrained semantic containment.
- Prioritizes workspace/output clarity over chat-like or role-play visual language.

## Remaining Design Debt (Tracked)
- Legacy `apps/web/app/globals.css` and older `apps/web/components/*` still contain hardcoded color/arbitrary utility debt.
- Debt is currently mitigated with compatibility tokens; incremental migration should move those surfaces to primitives/token-only classes.
