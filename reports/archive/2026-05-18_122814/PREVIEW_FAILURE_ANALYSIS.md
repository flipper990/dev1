# PREVIEW_FAILURE_ANALYSIS

## Scope
Analyzed real preview failure artifacts and logs (not the old `INVALID_PACKAGE_JSON strict-react-next-bundle-pins` issue).

## Primary Failure Evidence (historical blocker)
Source: `apps/api/src/testing/last-local-preview-failure.json` for project `6e7d2ctj28kh`.

Observed runtime chain:
- Generated app booted into Next dev pipeline and hit CSS/PostCSS load path (`src/app/globals.css`).
- Local preview attempt #2 failed with dev-server exit before ready.
- Error tail showed CSS pipeline failure path through `postcss-loader` and `globals.css`.

Root cause from generated artifact inspection:
- `package.json` had `"type": "module"`.
- `postcss.config.js` used CommonJS `module.exports`.
- This ESM/CJS mismatch breaks Next/PostCSS runtime in the generated preview runtime.

Failure classification:
- `Next startup issue`
- `CSS import/error path`
- `Tailwind/PostCSS config error`
- `generated app build/runtime failure`
- Secondary misclassification observed in older timeout dump (`install-hung`) even though install had completed and probing had started.

## Current Single Tier-1 Rerun Result (post-fix)
Source: `apps/api/src/testing/successful-mission-results.json` (run started `2026-05-15T18:09:51.583Z`, API `http://127.0.0.1:3013`).

- Tier-1 workload: exactly 1 prompt.
- Mission failed before preview with `mission ended with status=failed: unknown`.
- `filesCount=0`, `previewState=null`, so preview boot path was not reached in this run.

Conclusion:
- Original preview blocker root cause was real and addressed.
- The post-fix Tier-1 failure was upstream mission-generation failure, not preview startup.
