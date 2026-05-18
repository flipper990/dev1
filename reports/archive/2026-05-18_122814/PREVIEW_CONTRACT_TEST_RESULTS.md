# PREVIEW_CONTRACT_TEST_RESULTS

## Executed Tests

### Preview contract/unit
Command:
`npm exec --workspace=@devteam/api -- tsx --test src/preview/local-runner.env.test.ts src/preview/preview-file-validator.test.ts`

Result:
- PASS (9/9)

Coverage added in `src/preview/preview-file-validator.test.ts`:
- valid generated Next baseline passes
- missing layout fails fast
- missing page fails fast
- invalid global CSS import fails fast
- invalid CSS syntax fails fast
- `type=module` + CommonJS postcss config fails fast

### Required package contract tests
Command:
`npm run test:package:unit --workspace=@devteam/api`

Result:
- PASS (6/6)

Command:
`npm run test:contracts:fast --workspace=@devteam/api`

Result:
- PASS (`[contract-fast-check] ok`)

## Notes
No full Tier-2/Tier-3 suite was run.
