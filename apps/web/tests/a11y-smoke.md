# Accessibility Smoke Tests

## Purpose
Catch obvious regressions in semantic landmarks and interaction affordances.

## Command
- `npm run test:smoke:a11y`

## Coverage
- `/`
- `/projects`
- `/workspace`
- `/agents`
- `/settings`

## Assertions
- Main landmark presence.
- Focus style hooks / interactive accessibility affordances.
- ARIA usage presence on rendered pages.

## Limitation
This is a smoke layer; pair with Storybook a11y addon and manual keyboard QA.
