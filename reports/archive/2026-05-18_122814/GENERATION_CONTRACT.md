# Generation Contract

## Objective
Convert generated projects from permissive AI output into a deterministic, machine-validated artifact contract.

## Required Files (Canonical)
- `package.json`
- `tsconfig.json`
- `next.config.mjs`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`

## Allowed Critical Locations
- `src/app/**`
- `src/components/**`
- `src/lib/**`
- root config files (`package.json`, `tsconfig.json`, `next.config.*`, `postcss.config.*`, `tailwind.config.*`)

## package.json Contract
- Must be valid JSON.
- Must include scripts:
  - `dev`: `next dev`
  - `build`: `next build`
  - `start`: `next start`
  - `preview`: `next dev`
  - `typecheck`: `tsc --noEmit`
- Must include core dependencies:
  - `next`, `react`, `react-dom`
- Must include core dev dependencies:
  - `typescript`, `@types/node`, `@types/react`, `@types/react-dom`

## Build/Dev/Preview Commands
- Build: `npm run build`
- Dev: `npm run dev`
- Preview: `npm run preview`

## Required Entrypoints/Exports
- `src/app/layout.tsx` exports default layout component.
- `src/app/page.tsx` exports default page component.

## Dependency Rules
- Core framework deps are deterministic and injected.
- Package compatibility is validated via `validatePackageJsonString`.
- Import integrity is validated (no dangling internal imports).

## Forbidden Patterns
- Empty source files.
- Invalid paths (`..`, absolute paths).
- Placeholder content in critical entrypoint (`src/app/page.tsx`): `TODO`, `FIXME`, `coming soon`, `being prepared`, `placeholder`.

## Internal Import Rules
- All relative/internal imports must resolve in generated file set.
- Dangling imports are blocking violations.

## File Size Rules
- Max file size: 300 KB.

## Generated Manifest Schema
- `files: [{ path: string, bytes: number, kind: source|config|asset|doc|other }]`
- `routes: string[]`
- `components: string[]`
- `dependencies: string[]`

## Enforcement Points
- Slice-local quick validation (`runPostSliceQuickValidation`) applies deterministic contract and patches forward.
- Final assembly enforces contract; blocking violations fail generation before preview/export.
