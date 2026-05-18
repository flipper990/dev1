# CSS_RUNTIME_FIX_REPORT

## Root Cause
Generated projects could contain:
- `package.json` with `"type":"module"`
- `postcss.config.js` with CommonJS `module.exports`

This breaks Next CSS/PostCSS startup path for `src/app/globals.css` in preview runtime.

## Fixes Applied

### 1) Deterministic PostCSS config baseline
File: `apps/api/src/pipeline/deterministic-generation-contract.ts`

- Upserts deterministic ESM `postcss.config.js`:
  - `const config = { plugins: { tailwindcss: {}, autoprefixer: {} } }`
  - `export default config`

### 2) Preflight normalization/repair
File: `apps/api/src/preview/preview-dependency-preflight.ts`

- Rewrites CommonJS postcss config to ESM for module-typed packages.
- Generates missing postcss config when Tailwind directives exist in globals.css.

### 3) Contract fail-fast guard
File: `apps/api/src/preview/preview-file-validator.ts`

- Detects and fails with `invalid-postcss-config-module-format` before preview startup.
- Detects malformed globals.css (`invalid-css-syntax`).
- Detects invalid global CSS import placement (`invalid-global-css-import`).

## Effect
CSS/runtime failures now surface as explicit contract or build errors, reducing opaque startup timeout behavior for this class of generated app failures.
