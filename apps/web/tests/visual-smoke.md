# Visual Regression Smoke

## Purpose
Track coarse HTML output drift across legacy and redesign variants.

## Command
- `npm run test:smoke:visual`

## Output
- Route + query variant hashes.

## Interpretation
- Hash changes indicate UI output drift and should trigger screenshot review.
- Expected drift during intentional UI updates should be documented in release notes.
