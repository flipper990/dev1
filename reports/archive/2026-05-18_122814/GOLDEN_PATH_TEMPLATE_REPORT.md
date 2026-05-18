# Golden Path Template Report

## Goal
Stabilize generation by starting from a known-good foundation and reducing AI responsibility for infrastructure-critical files.

## Implemented Golden Path
- New deterministic contract module: `apps/api/src/pipeline/deterministic-generation-contract.ts`
- Enforced baseline files/templates:
  - `package.json` (canonical scripts + core deps)
  - `tsconfig.json`
  - `next.config.mjs`
  - `src/app/layout.tsx`
  - `src/app/page.tsx`
  - `src/app/globals.css`

## AI Freedom Reduced (Deterministic Now)
- `package.json` scripts and core dependency set
- `tsconfig` baseline
- `next.config` baseline
- Required app entrypoints and fallback content
- Structured artifact manifest generation

## AI Still Generates
- App-specific pages
- Feature components
- Styling details
- Domain logic and routes (within contract)

## Why This Addresses Root Causes
- Removes `MISSING_PACKAGE_JSON` class by construction.
- Prevents placeholder/empty critical entrypoints from passing forward.
- Prevents final dangling imports from slipping through to preview/export.
- Reduces mixed-layout drift impact by canonical `src/app` baseline.

## Residual Risks
- External provider quota/model endpoint failures remain external.
- Environment-specific preview install permissions remain infra/runtime concerns.
