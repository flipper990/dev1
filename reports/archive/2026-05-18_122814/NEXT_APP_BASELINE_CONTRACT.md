# NEXT_APP_BASELINE_CONTRACT

## Deterministic Baseline Enforcement
File: `apps/api/src/pipeline/deterministic-generation-contract.ts`

The deterministic contract now enforces a stable Next App Router shell by ensuring these files exist/upsert deterministically:
- `package.json`
- `tsconfig.json`
- `next.config.mjs`
- `postcss.config.js` (ESM export)
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`

## Preview Contract Validation (fail-fast)
File: `apps/api/src/preview/preview-file-validator.ts`

Added explicit Next/CSS contract checks and reasons:
- `missing-next-layout`
- `missing-next-page`
- `missing-next-globals-css`
- `invalid-global-css-import`
- `invalid-css-syntax`
- `invalid-postcss-config-module-format`

Validation guarantees before preview startup:
- root App Router layout/page presence
- globals.css presence
- globals.css imported only from root layout
- no malformed global CSS brace structure
- no ESM/CJS mismatch (`type=module` + `postcss.config.js` CommonJS)

## Dependency preflight infra normalization
File: `apps/api/src/preview/preview-dependency-preflight.ts`

Added infrastructure normalization before dependency reconciliation:
- rewrites `postcss.config.js` CommonJS -> ESM when package is `type=module`
- generates deterministic ESM `postcss.config.js` if Tailwind directives are present and config is missing
