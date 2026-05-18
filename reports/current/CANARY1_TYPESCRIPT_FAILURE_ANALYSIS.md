# Canary 1 TypeScript Failure Analysis

## Evidence inspected
- apps/api/src/testing/successful-mission-results.json (historical failed canary entry for project `ft2kQbaBbriC`)
- apps/api/src/testing/last-local-preview-failure.json
- Generated runtime project for failed canary: `apps/api/data/test-runs/2026-05-18T14-43-48-654Z-28652/projects/ft2kQbaBbriC/output/.preview-runtime`
- Failing generated files:
  - `src/app/404.tsx`
  - `src/components/ui/Button.tsx`

## Exact failure (historical canary 1 fail)
- Failed file: `./src/app/404.tsx:25:21`
- Error class: TypeScript build error
- Message (exact class): `Property 'as' does not exist on type ... ButtonProps ...`
- Failure category: `generated_typescript_error`
- Failure phase/step: `finalize / finalize:completed`

## Root cause
Generated page used link-like button syntax (`<Button as="a" ...>`) while generated canonical `Button` contract only supported `React.ButtonHTMLAttributes<HTMLButtonElement>` with no `as` support.

## Classification
This is a deterministic generated TypeScript contract mismatch, not provider/auth/db/preview-proxy.
